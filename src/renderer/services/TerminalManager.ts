/**
 * 终端管理服务
 *
 * 职责：
 * - 管理用户交互式终端的生命周期（创建、销毁）
 * - 管理 xterm 实例和 PTY 进程
 * - 提供统一 API 给 UI 层
 *
 * 注意：普通短命令使用 shell:executeBackground；Agent 长命令会通过此服务创建交互会话。
 */

import { api } from "@/renderer/services/electronAPI";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { getEditorConfig } from "@renderer/settings";
import { logger } from "@utils/Logger";
import { toAppError } from "@shared/utils/errorHandler";

// ===== 类型定义 =====

export interface TerminalInstance {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  createdAt: number;
  /** 是否为 Agent 专属终端 */
  isAgent?: boolean;
  /** 远程 SSH 连接信息 */
  remote?: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string };
  /** 远程主机地址（用于显示） */
  remoteHost?: string;
}

export interface RunningCommandInfo {
  terminalId: string;
  command: string;
  startedAt: number;
}

export interface TerminalManagerState {
  terminals: TerminalInstance[];
  activeId: string | null;
  /** 当前正在执行的命令（用于 UI 显示 spinner） */
  runningCommand: RunningCommandInfo | null;
}

export interface CommandResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

export type TerminalBackend = 'pty' | 'pipe';

interface XTermInstance {
  terminal: XTerminal;
  fitAddon: FitAddon;
  webglAddon?: WebglAddon;
  container: HTMLDivElement | null;
}

type StateListener = (state: TerminalManagerState) => void;

// ===== 终端管理器 =====

// 获取终端缓冲配置（从 editorConfig 读取）
function getOutputBufferConfig() {
  const config = getEditorConfig();
  const maxLines = config.performance.terminalBufferSize || 1000;
  return {
    maxLines,
    // 使用行数 * 平均行长度估算，避免频繁计算字节
    maxTotalChars: maxLines * 200,
  };
}

/**
 * 环形缓冲区 — O(1) 写入和裁剪
 * 替代原来的 array.splice O(n) 方案
 */
class RingBuffer {
  private buf: string[]
  private head = 0    // 最旧元素的索引
  private count = 0   // 当前元素数
  private capacity: number
  totalChars = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buf = new Array(capacity)
  }

  push(data: string): void {
    if (this.count < this.capacity) {
      this.buf[(this.head + this.count) % this.capacity] = data
      this.count++
    } else {
      // 满了，覆盖最旧的
      this.totalChars -= this.buf[this.head].length
      this.buf[this.head] = data
      this.head = (this.head + 1) % this.capacity
    }
    this.totalChars += data.length
  }

  /** 按写入顺序返回所有元素 */
  toArray(): string[] {
    const result: string[] = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity]
    }
    return result
  }

  get length(): number { return this.count }

  clear(): void {
    this.head = 0
    this.count = 0
    this.totalChars = 0
  }
}

/** 剥离 ANSI 转义序列（用于 sentinel 输出提取） */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012B]/g, '')
    .replace(/\x1b[=><]/g, '')
    .replace(/\r/g, '')
}


class TerminalManagerClass {
  private state: TerminalManagerState = {
    terminals: [],
    activeId: null,
    runningCommand: null,
  };

  /** Agent 专属终端 ID（跨 tool call 复用） */
  private agentTerminalId: string | null = null;
  private agentTerminalCreating: Promise<string> | null = null;

  // xterm 实例管理
  private xtermInstances = new Map<string, XTermInstance>();
  // 环形缓冲区：O(1) 写入和裁剪
  private outputBuffers = new Map<string, RingBuffer>();

  // PTY 状态
  private ptyReady = new Map<string, boolean>();
  private pendingPtyCreation = new Map<string, Promise<boolean>>();

  // 监听器
  private stateListeners = new Set<StateListener>();
  private dataListeners = new Set<(id: string, data: string) => void>();

  // 主题配置
  private currentTheme: Record<string, string> = {};

  // IPC 监听器清理函数
  private ipcCleanup: (() => void) | null = null;

  constructor() {
    this.setupIpcListeners();
  }

  private setupIpcListeners() {
    const onData = api.terminal.onData(
      ({ id, data }: { id: string; data: string }) => {
        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(data);
        }

        // 缓存输出
        this.appendToBuffer(id, data);

        // 触发数据事件
        this.dataListeners.forEach(listener => listener(id, data));
      },
    );

    const onExit = api.terminal.onExit(
      ({
        id,
        exitCode,
        signal,
      }: {
        id: string;
        exitCode: number;
        signal?: number;
      }) => {
        logger.system.info(
          `[TerminalManager] Terminal ${id} exited with code ${exitCode}, signal ${signal}`,
        );

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
          );
        }

        // 清理 PTY 状态
        this.ptyReady.delete(id);
      },
    );

    const onError = api.terminal.onError?.(
      ({ id, error }: { id: string; error: string }) => {
        logger.system.error(`[TerminalManager] Terminal ${id} error:`, error);

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[31m[Terminal Error: ${error}]\x1b[0m\r\n`,
          );
        }
      },
    );

    this.ipcCleanup = () => {
      onData();
      onExit();
      onError?.();
    };
  }

  /**
   * 追加数据到输出缓冲区
   */
  private appendToBuffer(id: string, data: string): void {
    let buffer = this.outputBuffers.get(id);
    if (!buffer) {
      const config = getOutputBufferConfig();
      buffer = new RingBuffer(config.maxLines);
      this.outputBuffers.set(id, buffer);
    }

    // RingBuffer 自动处理容量溢出（O(1) 覆盖最旧数据）
    buffer.push(data);
  }

  /**
   * 获取缓冲区统计信息
   */
  getBufferStats(id: string): { lines: number; chars: number } | null {
    const buffer = this.outputBuffers.get(id);
    if (!buffer) return null;
    return { lines: buffer.length, chars: buffer.totalChars };
  }

  // ===== 状态订阅 =====

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  onData(listener: (id: string, data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  private notify() {
    const state = this.getState();
    this.stateListeners.forEach((listener) => listener(state));
  }

  getState(): TerminalManagerState {
    return {
      terminals: [...this.state.terminals],
      activeId: this.state.activeId,
      runningCommand: this.state.runningCommand,
    };
  }

  // ===== 主题管理 =====

  setTheme(theme: Record<string, string>) {
    this.currentTheme = theme;
    this.xtermInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme;
    });
  }

  // ===== 终端生命周期 =====

  async createTerminal(options: {
    name?: string;
    cwd: string;
    shell?: string;
    backend?: TerminalBackend;
    isAgent?: boolean;
    remote?: TerminalInstance['remote'];
  }): Promise<string> {
    const id = crypto.randomUUID();

    const instance: TerminalInstance = {
      id,
      name: options.name || "Terminal",
      cwd: options.cwd,
      shell: options.shell || "",
      createdAt: Date.now(),
      isAgent: options.isAgent,
      remote: options.remote,
      remoteHost: options.remote?.host,
    };

    this.state.terminals.push(instance);
    this.state.activeId = id;
    this.notify();

    // 创建 PTY
    const ptyPromise = this.createPty(id, options.cwd, options.shell, options.backend, options.remote);
    this.pendingPtyCreation.set(id, ptyPromise);

    try {
      const success = await ptyPromise;
      this.ptyReady.set(id, success);
    } catch {
      this.ptyReady.set(id, false);
    } finally {
      this.pendingPtyCreation.delete(id);
    }

    return id;
  }

  private async createPty(
    id: string,
    cwd: string,
    shell?: string,
    backend: TerminalBackend = 'pty',
    remote?: TerminalInstance['remote'],
  ): Promise<boolean> {
    try {
      const result = await api.terminal.create({ id, cwd, shell, backend, remote });
      if (!result?.success) {
        const errorMsg = result?.error || "Unknown error";
        logger.system.error(
          `[TerminalManager] Failed to create PTY for ${id}:`,
          errorMsg,
        );

        // 显示错误信息到终端
        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(`\r\n\x1b[31m[Error: ${errorMsg}]\x1b[0m\r\n`);
          if (errorMsg.includes("rebuild")) {
            xterm.terminal.write(
              `\x1b[33mPlease run: npm run rebuild\x1b[0m\r\n`,
            );
          }
        }
        return false;
      }
      return true;
    } catch (err) {
      const error = toAppError(err);
      logger.system.error(
        `[TerminalManager] Exception creating PTY for ${id}: ${error.code}`,
        error,
      );

      // 显示错误信息到终端
      const xterm = this.xtermInstances.get(id);
      if (xterm?.terminal) {
        xterm.terminal.write(
          `\r\n\x1b[31m[Error: ${error.message}]\x1b[0m\r\n`,
        );
      }
      return false;
    }
  }

  mountTerminal(id: string, container: HTMLDivElement): boolean {
    if (this.xtermInstances.has(id)) {
      const existing = this.xtermInstances.get(id)!;
      if (existing.container !== container) {
        existing.terminal.open(container);
        existing.container = container;
        try {
          // 如果之前被卸载了 WebGL，则重新挂载
          if (!existing.webglAddon) {
            const webglAddon = new WebglAddon();
            existing.terminal.loadAddon(webglAddon);
            existing.webglAddon = webglAddon;
            webglAddon.onContextLoss(() => {
              webglAddon.dispose();
              existing.webglAddon = undefined;
            });
          }
          existing.fitAddon.fit();
        } catch { }
      }
      return true;
    }

    const termConfig = getEditorConfig().terminal;
    const terminal = new XTerminal({
      cursorBlink: termConfig.cursorBlink,
      fontFamily: termConfig.fontFamily,
      fontSize: termConfig.fontSize,
      lineHeight: termConfig.lineHeight,
      scrollback: termConfig.scrollback,
      allowProposedApi: true,
      theme: this.currentTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);

    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = undefined;
        if (this.xtermInstances.has(id)) {
          this.xtermInstances.get(id)!.webglAddon = undefined;
        }
      });
    } catch { }

    // 处理终端输入
    terminal.onData((data) => {
      api.terminal.write(id, data);
    });
    // 处理粘贴文本
    const handlePasteText = (text: string) => {
      api.terminal.write(id, text);
    };

    // 处理复制粘贴快捷键
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+C 复制（有选中内容时）
      if (event.ctrlKey && event.key === "c" && event.type === "keydown") {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          return false; // 阻止默认行为
        }
        // 没有选中内容时，让 Ctrl+C 发送到终端（中断信号）
        return true;
      }

      // Only handle keydown events to prevent duplicate execution
      if (event.type !== "keydown") return true;

      // Ctrl+V for paste
      if (event.ctrlKey && !event.shiftKey && event.key === "v") {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => {
          handlePasteText(text);
        });
        return false;
      }

      // Ctrl+Shift+C 复制（备用）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "C" &&
        event.type === "keydown"
      ) {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false;
      }

      // Ctrl+Shift+V 粘贴（备用）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "V" &&
        event.type === "keydown"
      ) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              api.terminal.write(id, text);
            }
          })
          .catch(() => { });
        return false;
      }

      return true; // 其他按键正常处理
    });

    this.xtermInstances.set(id, { terminal, fitAddon, webglAddon, container });

    // 回放已有 buffer —— 解决 xterm 挂载前 PTY 已产生输出导致终端显示为空的问题
    const existingBuffer = this.outputBuffers.get(id);
    if (existingBuffer && existingBuffer.length > 0) {
      for (const chunk of existingBuffer.toArray()) {
        terminal.write(chunk);
      }
    }

    try {
      fitAddon.fit();
    } catch { }

    const dims = fitAddon.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) {
      api.terminal.resize(id, dims.cols, dims.rows);
    }

    return true;
  }

  /**
   * 卸载 xterm UI 实例以释放 DOM/WebGL 内存，但 PTY 进程和 outputBuffer 完整保留。
   * 下次 mountTerminal 时会新建 xterm 并将 buffer 全量回放，用户看到完整历史。
   */
  unmountTerminal(id: string) {
    const existing = this.xtermInstances.get(id);
    if (!existing) return;

    if (existing.webglAddon) {
      try { existing.webglAddon.dispose(); } catch { }
      existing.webglAddon = undefined;
    }

    try { existing.terminal.dispose(); } catch { }

    // 从 map 中移除，确保下次 mountTerminal 走"新建实例 + buffer replay"分支
    // 而不是尝试在已销毁的 terminal 上调用 open()（会静默失败导致空白）
    this.xtermInstances.delete(id);
  }

  fitTerminal(id: string) {
    const instance = this.xtermInstances.get(id);
    if (!instance) return;

    try {
      instance.fitAddon.fit();
      const dims = instance.fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        api.terminal.resize(id, dims.cols, dims.rows);
      }
    } catch { }
  }

  closeTerminal(id: string) {
    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.terminal.dispose();
      this.xtermInstances.delete(id);
    }

    if (this.agentTerminalId === id) {
      this.agentTerminalId = null
    }

    this.outputBuffers.delete(id);
    this.ptyReady.delete(id);
    api.terminal.kill(id);

    const index = this.state.terminals.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.state.terminals.splice(index, 1);
    }

    if (this.state.activeId === id) {
      this.state.activeId = this.state.terminals[0]?.id || null;
    }

    this.notify();
  }

  hasTerminal(id: string): boolean {
    return this.state.terminals.some(t => t.id === id);
  }

  setActiveTerminal(id: string | null) {
    // 验证终端是否存在，不存在则静默忽略（终端可能已被手动关闭）
    if (id !== null && !this.state.terminals.find(t => t.id === id)) {
      return;
    }
    if (this.state.activeId !== id) {
      this.state.activeId = id;
      this.notify();
    }
  }

  // ===== 工具方法 =====

  writeToTerminal(id: string, data: string) {
    api.terminal.write(id, data);
  }

  getOutputBuffer(id: string): string[] {
    return this.outputBuffers.get(id)?.toArray() || [];
  }

  getXterm(id: string): XTerminal | null {
    return this.xtermInstances.get(id)?.terminal || null;
  }

  focusTerminal(id: string) {
    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.terminal.focus();
    }
  }

  // ===== Agent 专属终端 =====

  /**
   * 获取或创建 Agent 专属终端。
   * Agent 终端跨 tool call 复用，避免每次 run_command 产生孤立 tab。
   */
  async getOrCreateAgentTerminal(cwd: string, shell?: string): Promise<string> {
    // 检查现有 agent 终端是否仍然存活
    if (this.agentTerminalId) {
      const exists = this.state.terminals.find(t => t.id === this.agentTerminalId)
      if (exists) return this.agentTerminalId
      // 已被关闭，重置
      this.agentTerminalId = null
    }

    // 并发锁：防止快速连续的 run_command 创建多个 Agent 终端
    if (this.agentTerminalCreating) {
      return this.agentTerminalCreating
    }

    this.agentTerminalCreating = this.createTerminal({
      name: 'Agent',
      cwd,
      shell,
      isAgent: true,
    }).then(id => {
      this.agentTerminalId = id
      this.agentTerminalCreating = null
      return id
    }).catch(err => {
      this.agentTerminalCreating = null
      throw err
    })

    return this.agentTerminalCreating
  }

  /**
   * 释放当前 Agent 终端绑定（不关闭终端）。
   * 长进程占用终端后调用，使下一次 getOrCreateAgentTerminal() 创建新终端。
   */
  releaseAgentTerminal() {
    this.agentTerminalId = null
  }

  /**
   * 在指定终端执行命令，通过 sentinel 标记精确捕获本次命令的输出。
   * 命令过程对用户可见（在终端面板里显示），同时将 stdout 作为字符串返回给 AI。
   *
   * @param cwd 可选工作目录。若提供，用 Push-Location/popd（PS）或子 shell（Unix）临时切换目录。
   */
  executeCommandWithOutput(termId: string, command: string, timeoutMs: number, cwd?: string): Promise<CommandResult> {
    const sentinelId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    // OSC 序列格式：ESC ] 9001 ; <payload> BEL
    // xterm.js 在序列解析阶段静默消耗未注册的 OSC 编号，完全不渲染任何文本。
    // 这与 VS Code Shell Integration（OSC 133）采用相同机制。
    const OSC = '\x1b]9001;'
    const BEL = '\x07'
    const START_PAYLOAD = `ADNIFY_CMD_START_${sentinelId}`
    const END_PAYLOAD_PREFIX = `ADNIFY_CMD_END_${sentinelId}_`
    // 用于在原始数据中检测 end sentinel
    const RAW_END_MARKER = `${OSC}${END_PAYLOAD_PREFIX}`

    // 广播运行状态
    this.state.runningCommand = { terminalId: termId, command, startedAt: Date.now() }
    this.notify()

    return new Promise<CommandResult>((resolve) => {
      let rawAccumulator = ''   // 原始 PTY 数据，用于检测 OSC sentinel
      let textAccumulator = ''  // stripAnsi 后的纯文本，用于返回给 AI
      let textAtStart = -1      // 检测到 START sentinel 时 textAccumulator 的长度
      let settled = false

      const settle = (result: CommandResult) => {
        if (settled) return
        settled = true
        unsub()
        clearTimeout(timer)
        this.state.runningCommand = null
        this.notify()
        resolve(result)
      }

      const timer = setTimeout(() => {
        settle({ output: textAccumulator.trim(), exitCode: -1, timedOut: true })
      }, timeoutMs)

      const unsub = this.onData((id, data) => {
        if (id !== termId || settled) return
        rawAccumulator += data
        textAccumulator += stripAnsi(data)

        // OSC 序列被 stripAnsi 整体剥除，无文本残留。
        // 在 raw 中检测到 START 时记录 textAccumulator 当前长度，
        // 作为命令输出的起始游标（跳过 shell 回显、提示符等）
        if (textAtStart === -1 && rawAccumulator.includes(`${OSC}${START_PAYLOAD}${BEL}`)) {
          textAtStart = textAccumulator.length
        }

        // 在原始数据中检测 OSC end sentinel：ESC]9001;ADNIFY_CMD_END_..._N BEL
        const endIdx = rawAccumulator.indexOf(RAW_END_MARKER)
        if (endIdx !== -1) {
          const afterMarker = rawAccumulator.slice(endIdx + RAW_END_MARKER.length)
          const codeMatch = afterMarker.match(/^(\d+)\x07/)
          if (codeMatch) {
            const output = textAtStart !== -1
              ? textAccumulator.slice(textAtStart).trim()
              : textAccumulator.trim()
            settle({ output, exitCode: parseInt(codeMatch[1], 10), timedOut: false })
          }
        }
      })

      // 必须先订阅，再写命令（避免竞态）
      const isWindows = /windows/i.test(navigator.userAgent)

      // PowerShell 5.x 不支持 && 运算符；cmd.exe 的 cd /d 在 PS 里无效（/d 被当位置参数）
      const sanitizedCommand = isWindows
        ? command
            .replace(/\s*&&\s*/g, '; ')
            .replace(/\bcd\s+\/[dD]\s+(['"]?)([^;|&\n'"]+)\1/g, 'Push-Location "$2"')
        : command

      // cwd 参数：Agent 终端复用，需临时切换目录
      const cmdWithCwd = cwd
        ? (isWindows
            ? `Push-Location "${cwd}"; ${sanitizedCommand}; Pop-Location`
            : `(cd "${cwd}" && ${sanitizedCommand})`)
        : sanitizedCommand

      // OSC sentinel 命令（Windows/Unix/macOS 三平台）
      const sentinelStart = isWindows
        ? `Write-Host -NoNewline "$([char]27)]9001;${START_PAYLOAD}$([char]7)"`
        : `printf '\\033]9001;${START_PAYLOAD}\\007'`
      const sentinelEnd = isWindows
        ? `Write-Host -NoNewline "$([char]27)]9001;${END_PAYLOAD_PREFIX}$LASTEXITCODE$([char]7)"`
        : `printf '\\033]9001;${END_PAYLOAD_PREFIX}'\"$?\"'\\007'`

      const mainCommand = `${sentinelStart}; ${cmdWithCwd}; ${sentinelEnd}`

      // ── 回显清除策略 ──
      // PTY 行规程在内核层将发送的命令回显到终端（包装代码对用户可见），应用层无法阻止。
      // 解决方案：命令开始执行时立刻输出 ANSI "上移+清除行" 序列，将回显抹掉。
      //   \033[1A = 光标上移1行；\033[2K = 清除当前行。重复 N 次，N 为回显占用的行数。
      // 这与 VS Code/Cursor Shell Integration 使用 PROMPT_COMMAND 钩子的终态效果相同
      // （用户只看到命令输出，不看到包装代码），只是实现层级不同。
      //
      // N 的计算：ceil((提示符估算长度 + 完整命令长度) / 终端列数) + 1
      const xtermInst = this.xtermInstances.get(termId)
      const cols = xtermInst?.fitAddon?.proposeDimensions()?.cols ?? 80
      const promptLen = isWindows ? 60 : 35
      // 每个清除单元的字面长度（PS 使用 $([char]N) 表达式，Unix 使用 octal 转义）
      const clearUnit = isWindows ? '$([char]27)[1A$([char]27)[2K' : '\\033[1A\\033[2K'
      const clearWrapLen = isWindows ? 22 : 10  // "Write-Host -NoNewline ""; " 或 "printf ''; "
      // 两次迭代逼近（消除循环依赖）
      const roughLines = Math.ceil((promptLen + mainCommand.length) / cols)
      const clearOverhead = clearWrapLen + clearUnit.length * roughLines
      const echoLines = Math.ceil((promptLen + mainCommand.length + clearOverhead) / cols) + 1

      const clearSeq = clearUnit.repeat(echoLines)

      // 清除回显后，补打一行"伪提示符 + 原始命令"，让终端看起来像用户手动输入
      // Windows PS double-quoted string 转义：` → ``，" → `"，$ → `$
      // Unix double-quoted string 转义：\ → \\，" → \"，$ → \$，` → \`
      const displayCmd = isWindows
        ? command.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$')
        : command.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')

      // 提示符路径：有 cwd 时直接嵌入，否则运行时动态获取当前目录
      const fakeEchoCmd = isWindows
        ? `Write-Host -NoNewline "${clearSeq}"; Write-Host "PS ${cwd ?? '$(Get-Location)'}> ${displayCmd}"`
        : `printf '${clearSeq}'; printf '%s\\n' "${cwd ? cwd.replace(/\\/g, '/') : '$(pwd)'}\\$ ${displayCmd}"`

      const wrapped = `${fakeEchoCmd}; ${mainCommand}\r`

      this.writeToTerminal(termId, wrapped)
    })
  }

  cleanup() {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    for (const terminal of this.state.terminals) {
      this.closeTerminal(terminal.id);
    }

    this.agentTerminalId = null
    this.agentTerminalCreating = null
    this.state = {
      terminals: [],
      activeId: null,
      runningCommand: null,
    };
    this.notify();
  }
}

export const terminalManager = new TerminalManagerClass();
