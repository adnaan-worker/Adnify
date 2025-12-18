
1. 渲染进程可直接触发“任意命令执行”（高危/RCE 通道）

- 证据：src/main/ipc/terminal.ts:186（ipcMain.handle('shell:execute', ...) 内部 exec(command, ...)）；src/main/preload.ts:294（executeCommand 暴露到 window.electronAPI）
- 影响：一旦渲染进程出现 XSS/依赖注入/插件恶意代码，等同本机任意命令执行；也会放大 prompt injection 的危害（Agent 诱导执行系统命令）。
- 建议：把“命令执行”能力从默认 API 移除或强约束（只允许白名单子命令、强制 workspace cwd、禁用 shell 拼接、要求用户确认/权限开关、记录审计日志）。

2. 主进程文件写/删能力对路径几乎不设边界（高危/破坏面极大）

- 证据：src/main/ipc/file.ts:278（file:write 直接写入任意 filePath）；src/main/ipc/file.ts:351（file:delete 支持目录递归 rm
  -r）；src/main/preload.ts:244、src/main/preload.ts:250（writeFile/deleteFile 暴露到渲染进程）
- 影响：渲染进程被攻破或被诱导调用时，可改写/删除系统任意文件（例如用户文档、启动项、配置、ssh key 等）。
- 建议：在“主进程 IPC 层”强制 workspace 边界校验（不要只在 renderer/agent 层校验）；对 delete 增加保护（回收站、二次确认、禁止递归删除非 workspace）。

3. Git 回退实现存在命令拼接/注入风险（中高危）

- 证据：src/main/ipc/git.ts:23（exec(\git ${args.join(' ')}, ...)`）
- 影响：如果 args 来自不可信输入且可包含 shell 元字符，可能被注入执行额外命令；即使当前 UI 不暴露，后续 Agent/插件接入也容易踩坑。
- 建议：回退分支改为 spawn('git', args, { shell:false }) 这种“参数数组”方式；或彻底移除回退分支，只保留 dugite 并在初始化失败时显式报错。

4. 高权限能力暴露面过大（攻击面扩大、权限模型不清晰）

- 证据：src/main/preload.ts:223 开始暴露 electronAPI，包含文件系统、终端、Git、索引、LSP 等大量高权限 API（如 src/main/preload.ts:232-377）
- 影响：任何渲染侧漏洞都会立刻变成“本机高权限动作”；也让你难以做“最小权限/按功能授权”。
- 建议：拆分 capability（按模块分组 + 权限开关），默认只暴露低危 API；高危 API（命令执行/删除/批量写）需显式启用并绑定用户确认。

5. 供应链风险：postinstall 从公网下载 wasm 且无完整性校验

- 证据：package.json:22（postinstall: node scripts/download-wasm.js）；scripts/download-wasm.js:6（unpkg.com 下载）；scripts/download-wasm.js:65（https.get 直接写文件），未见 hash 校验
- 影响：安装期执行网络下载，若上游内容被投毒/劫持/回滚，可能导致运行期解析/索引行为不可控；离线/内网环境也会安装失败或功能缺失。
- 建议：固定版本 + 校验 hash（或改为随发布包内置资源）；至少对下载内容做 sha256 校验并失败时中止安装或给出明确降级。

6. CI/发布链路证据不足（质量门槛不明确）

- 证据：仓库未发现常见 CI 配置：.github/** 为空（无文件）；也未发现 .gitlab-ci.yml/Jenkinsfile 等（根目录无匹配）
- 影响：测试、打包、依赖审计、签名等质量控制可能只靠本地；回归与安全基线难持续。
- 建议：补最小 CI：npm ci + npm test + npm run build，再加依赖审计/许可证检查（按你目标选择）。

7. “终端能力”+“后台命令执行”双通道，安全策略更难统一

- 证据：PTY 终端：src/main/ipc/terminal.ts:40（terminal:create）；后台 exec：src/main/ipc/terminal.ts:186（shell:execute）
- 影响：即使你限制了 PTY 交互，shell:execute 仍是绕过通道；安全策略分散导致遗漏。
- 建议：统一为一个受控执行层（策略、审计、权限在同一处），renderer 只拿到“受控 API”。

8. 搜索实现可能造成内存峰值/卡顿（性能缺点）

- 证据：src/main/ipc/search.ts:50（stdout 全量累积到 output 字符串），然后 split('\n') 再 JSON.parse（src/main/ipc/search.ts:62-75）
- 影响：在大仓库/匹配行多时，可能出现主进程内存峰值与解析阻塞；即使 --max-count 2000，单行也可能较大。
- 建议：按行流式解析（逐行处理 JSON），避免整段累积；并在主进程侧加超时/取消。

9. 文件读取策略可能导致 UI 卡顿/错误体验（健壮性缺点）

- 证据：src/main/ipc/file.ts:262（大于 5MB 改 readLargeFile），但流读固定 utf-8（src/main/ipc/file.ts:44），与上面的“自动编码检测”不一致
- 影响：非 UTF-8 大文件可能乱码；读取行数/大小策略固定，可能造成编辑体验不稳定。
- 建议：大文件也做更稳健的编码处理与分页读取，并在 UI 显式提示“超大文件只显示前 N 行”。

10. 测试存在但覆盖重点不匹配（质量缺点）

- 证据：测试入口存在 vitest（package.json:19、vitest.config.ts:5）；但 tests 主要是性质测试与 chunker demo（tests/treeSitterTest.ts:1），未见对高危 IPC（file/terminal/git）权限边界的测试。
- 影响：核心风险点（IPC 权限与输入约束）缺乏自动回归；安全加固后也更容易回归。
- 建议：增加主进程 IPC 的单测/集成测试（至少：路径限制、拒绝敏感路径、拒绝危险命令等）。

11. 单实例锁 + close 清理逻辑可能导致边缘状态复杂（可维护性/稳定性）

- 证据：src/main/main.ts:17（requestSingleInstanceLock）；src/main/main.ts:98（close 事件里做同步/异步清理并 app.quit()）
- 影响：关闭流程里混合同步/异步，未来加更多资源清理时容易出现竞态（重复退出、窗口对象销毁时机）。
- 建议：把“退出态机”集中管理（只允许一次进入 quitting），所有清理集中并可超时降级。

12. 打包 asarUnpack 扩大原生依赖暴露面（供应链/体积/攻击面）

- 证据：package.json:82（asarUnpack 包含 node-pty、@vscode/ripgrep、dugite、@lancedb）
- 影响：原生二进制与工具链被解包到磁盘，提升被本地篡改/被杀软误报/被环境干扰的概率；体积也更难控。
- 建议：必要就保留，但配合签名/校验与最小化解包范围；确保运行时只加载你需要的那部分。

  我已经把“测试/CI 与供应链风险”也纳入结论（见第 5/6/10/12 条）。下一步如果你要“直接开始优化”，最优先动刀的就是：

- src/main/ipc/terminal.ts:186（shell:execute）
- src/main/ipc/file.ts:278 / src/main/ipc/file.ts:351（写/删）
- src/main/ipc/git.ts:23（git 回退 exec 拼接）
- src/main/preload.ts:223（暴露面收敛）
