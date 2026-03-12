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
    trimRatio: 0.3,
  };
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

  // xterm 实例管理
  private xtermInstances = new Map<string, XTermInstance>();
  // 简化缓冲区：只记录行数和字符数（比字节数计算更快）
  private outputBuffers = new Map<
    string,
    { lines: string[]; totalChars: number }
  >();

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
      buffer = { lines: [], totalChars: 0 };
      this.outputBuffers.set(id, buffer);
    }

    buffer.lines.push(data);
    buffer.totalChars += data.length;

    const config = getOutputBufferConfig();

    // 检查是否需要裁剪
    if (
      buffer.lines.length > config.maxLines ||
      buffer.totalChars > config.maxTotalChars
    ) {
      const keepCount = Math.floor(
        buffer.lines.length * (1 - config.trimRatio),
      );
      const removed = buffer.lines.splice(0, buffer.lines.length - keepCount);
      // 减去被移除的字符数
      for (const line of removed) {
        buffer.totalChars -= line.length;
      }
    }
  }

  /**
   * 获取缓冲区统计信息
   */
  getBufferStats(id: string): { lines: number; chars: number } | null {
    const buffer = this.outputBuffers.get(id);
    if (!buffer) return null;
    return { lines: buffer.lines.length, chars: buffer.totalChars };
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
  }): Promise<string> {
    const id = crypto.randomUUID();

    const instance: TerminalInstance = {
      id,
      name: options.name || "Terminal",
      cwd: options.cwd,
      shell: options.shell || "",
      createdAt: Date.now(),
      isAgent: options.isAgent,
    };

    this.state.terminals.push(instance);
    this.state.activeId = id;
    this.notify();

    // 创建 PTY
    const ptyPromise = this.createPty(id, options.cwd, options.shell, options.backend);
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
  ): Promise<boolean> {
    try {
      const result = await api.terminal.create({ id, cwd, shell, backend });
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
    if (existingBuffer && existingBuffer.lines.length > 0) {
      for (const chunk of existingBuffer.lines) {
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

  setActiveTerminal(id: string | null) {
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
    return this.outputBuffers.get(id)?.lines || [];
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

    const id = await this.createTerminal({
      name: 'Agent',
      cwd,
      shell,
      isAgent: true,
    })
    this.agentTerminalId = id
    return id
  }

  /**
   * 在指定终端执行命令，通过 sentinel 标记精确捕获本次命令的输出。
   * 命令过程对用户可见（在终端面板里显示），同时将 stdout 作为字符串返回给 AI。
   */
  executeCommandWithOutput(termId: string, command: string, timeoutMs: number): Promise<CommandResult> {
    const sentinelId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const START = `ADNIFY_CMD_START_${sentinelId}`
    const END_PREFIX = `ADNIFY_CMD_END_${sentinelId}_`

    // 广播运行状态
    this.state.runningCommand = { terminalId: termId, command, startedAt: Date.now() }
    this.notify()

    return new Promise<CommandResult>((resolve) => {
      let accumulator = ''
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
        settle({ output: this.extractSentinelOutput(accumulator, START, END_PREFIX).output, exitCode: -1, timedOut: true })
      }, timeoutMs)

      const unsub = this.onData((id, data) => {
        if (id !== termId || settled) return
        accumulator += stripAnsi(data)

        if (accumulator.includes(END_PREFIX)) {
          const { output, exitCode } = this.extractSentinelOutput(accumulator, START, END_PREFIX)
          settle({ output, exitCode, timedOut: false })
        }
      })

      // 必须先订阅，再写命令（避免竞态）
      // 渲染进程无 process 对象，用 navigator.userAgent 判断平台
      // Sentinel 用 ANSI Conceal（\e[8m）隐藏，用户不可见但仍在流中可被检测
      const ESC = '\x1b'
      const HIDE = `${ESC}[8m`  // Conceal on
      const SHOW = `${ESC}[0m`  // Reset
      const isWindows = /windows/i.test(navigator.userAgent)
      // Windows 默认 PowerShell：用 ; 分隔语句，$LASTEXITCODE 获取退出码
      // Unix/macOS：bash/zsh 用 ; 分隔，$? 获取退出码
      const wrapped = isWindows
        ? `Write-Host "${HIDE}${START}${SHOW}"; ${command}; Write-Host "${HIDE}${END_PREFIX}$LASTEXITCODE${SHOW}"\r`
        : `printf '${HIDE}${START}${SHOW}\\n'; ${command}; printf '${HIDE}${END_PREFIX}'\"$?\"'${SHOW}\\n'\r`
      this.writeToTerminal(termId, wrapped)
    })
  }

  private extractSentinelOutput(buffer: string, start: string, endPrefix: string): { output: string; exitCode: number } {
    const startIdx = buffer.indexOf(start)
    if (startIdx === -1) return { output: buffer.trim(), exitCode: 0 }

    // 跳过 start 标记本身及其后的换行/空白
    let contentStart = startIdx + start.length
    while (contentStart < buffer.length && '\n \t\r'.includes(buffer[contentStart])) {
      contentStart++
    }

    const endIdx = buffer.indexOf(endPrefix, contentStart)
    if (endIdx === -1) return { output: buffer.slice(contentStart).trim(), exitCode: 0 }

    const output = buffer.slice(contentStart, endIdx).trim()

    // 提取退出码（数字紧跟在 endPrefix 后面）
    const afterEnd = buffer.slice(endIdx + endPrefix.length)
    const codeMatch = afterEnd.match(/(\d+)/)
    const exitCode = codeMatch ? parseInt(codeMatch[1], 10) : 0

    return { output, exitCode }
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
    this.state = {
      terminals: [],
      activeId: null,
      runningCommand: null,
    };
    this.notify();
  }
}

export const terminalManager = new TerminalManagerClass();
