/**
 * Electron API 适配器
 * 将扁平的 window.electronAPI 包装成分组的 API 结构
 */

// 创建分组 API 适配器
function createGroupedAPI() {
  const raw = window.electronAPI

  return {
    // 应用生命周期
    appReady: () => raw.appReady(),
    getAppVersion: () => raw.getAppVersion(),

    // 窗口控制
    window: {
      minimize: () => raw.minimize(),
      maximize: () => raw.maximize(),
      close: () => raw.close(),
      toggleDevTools: () => raw.toggleDevTools(),
      new: () => raw.newWindow(),
      getId: () => raw.getWindowId(),
      resize: (width: number, height: number, minWidth?: number, minHeight?: number) => 
        raw.resizeWindow(width, height, minWidth, minHeight),
    },

    // 文件操作
    file: {
      open: () => raw.openFile(),
      openFolder: () => raw.openFolder(),
      selectFolder: () => raw.selectFolder(),
      readDir: (path: string) => raw.readDir(path),
      getTree: (path: string, maxDepth?: number) => raw.getFileTree(path, maxDepth),
      read: (path: string) => raw.readFile(path),
      readBinary: (path: string) => raw.readBinaryFile(path),
      write: (path: string, content: string) => raw.writeFile(path, content),
      save: (content: string, path?: string) => raw.saveFile(content, path),
      exists: (path: string) => raw.fileExists(path),
      mkdir: (path: string) => raw.mkdir(path),
      ensureDir: (path: string) => raw.ensureDir(path),
      delete: (path: string) => raw.deleteFile(path),
      rename: (oldPath: string, newPath: string) => raw.renameFile(oldPath, newPath),
      showInFolder: (path: string) => raw.showItemInFolder(path),
      search: (query: string, rootPath: string | string[], options?: Parameters<typeof raw.searchFiles>[2]) => 
        raw.searchFiles(query, rootPath, options),
      onChanged: (callback: Parameters<typeof raw.onFileChanged>[0]) => raw.onFileChanged(callback),
    },

    // 工作区
    workspace: {
      open: () => raw.openWorkspace(),
      addFolder: () => raw.addFolderToWorkspace(),
      save: (configPath: string, roots: string[]) => raw.saveWorkspace(configPath, roots),
      restore: () => raw.restoreWorkspace(),
      setActive: (roots: string[]) => raw.setActiveWorkspace(roots),
      getRecent: () => raw.getRecentWorkspaces(),
      clearRecent: () => raw.clearRecentWorkspaces(),
      removeFromRecent: (path: string) => raw.removeFromRecentWorkspaces(path),
    },

    // 设置
    settings: {
      get: (key: string) => raw.getSetting(key),
      set: (key: string, value: unknown) => raw.setSetting(key, value),
      getConfigPath: () => raw.getConfigPath(),
      setConfigPath: (path: string) => raw.setConfigPath(path),
      getWhitelist: () => raw.getWhitelist(),
      resetWhitelist: () => raw.resetWhitelist(),
      getUserDataPath: () => raw.getUserDataPath(),
      getRecentLogs: () => raw.getRecentLogs(),
      onChanged: (callback: Parameters<typeof raw.onSettingsChanged>[0]) => raw.onSettingsChanged(callback),
    },

    // LLM
    llm: {
      send: (params: Parameters<typeof raw.sendMessage>[0]) => raw.sendMessage(params),
      compactContext: (params: Parameters<typeof raw.compactContext>[0]) => raw.compactContext(params),
      abort: () => raw.abortMessage(),
      invalidateProviders: () => raw.invalidateProviders(),
      invalidateProvider: (providerId: string) => raw.invalidateProvider(providerId),
      onStream: (callback: Parameters<typeof raw.onLLMStream>[0]) => raw.onLLMStream(callback),
      onToolCall: (callback: Parameters<typeof raw.onLLMToolCall>[0]) => raw.onLLMToolCall(callback),
      onError: (callback: Parameters<typeof raw.onLLMError>[0]) => raw.onLLMError(callback),
      onDone: (callback: Parameters<typeof raw.onLLMDone>[0]) => raw.onLLMDone(callback),
    },

    // 终端
    terminal: {
      create: (options: { id: string; cwd?: string; shell?: string }) => raw.createTerminal(options),
      write: (id: string, data: string) => raw.writeTerminal(id, data),
      resize: (id: string, cols: number, rows: number) => raw.resizeTerminal(id, cols, rows),
      kill: (id?: string) => raw.killTerminal(id),
      getShells: () => raw.getAvailableShells(),
      onData: (callback: Parameters<typeof raw.onTerminalData>[0]) => raw.onTerminalData(callback),
      onExit: (callback: Parameters<typeof raw.onTerminalExit>[0]) => raw.onTerminalExit(callback),
      onError: (callback: Parameters<typeof raw.onTerminalError>[0]) => raw.onTerminalError(callback),
    },

    // Shell 执行
    shell: {
      executeSecure: (request: Parameters<typeof raw.executeSecureCommand>[0]) => raw.executeSecureCommand(request),
      executeBackground: (params: Parameters<typeof raw.executeBackground>[0]) => raw.executeBackground(params),
      onOutput: (callback: Parameters<typeof raw.onShellOutput>[0]) => raw.onShellOutput(callback),
    },

    // Git
    git: {
      execSecure: (args: string[], cwd: string) => raw.gitExecSecure(args, cwd),
    },

    // 安全管理
    security: {
      getAuditLogs: (limit?: number) => raw.getAuditLogs(limit),
      clearAuditLogs: () => raw.clearAuditLogs(),
      getPermissions: () => raw.getPermissions(),
      resetPermissions: () => raw.resetPermissions(),
    },

    // 索引
    index: {
      initialize: (workspacePath: string) => raw.indexInitialize(workspacePath),
      start: (workspacePath: string) => raw.indexStart(workspacePath),
      status: (workspacePath: string) => raw.indexStatus(workspacePath),
      hasIndex: (workspacePath: string) => raw.indexHasIndex(workspacePath),
      search: (workspacePath: string, query: string, topK?: number) => raw.indexSearch(workspacePath, query, topK),
      hybridSearch: (workspacePath: string, query: string, topK?: number) => raw.indexHybridSearch(workspacePath, query, topK),
      searchSymbols: (workspacePath: string, query: string, topK?: number) => raw.indexSearchSymbols(workspacePath, query, topK),
      getProjectSummary: (workspacePath: string) => raw.indexGetProjectSummary(workspacePath),
      getProjectSummaryText: (workspacePath: string) => raw.indexGetProjectSummaryText(workspacePath),
      setMode: (workspacePath: string, mode: 'structural' | 'semantic') => raw.indexSetMode(workspacePath, mode),
      updateFile: (workspacePath: string, filePath: string) => raw.indexUpdateFile(workspacePath, filePath),
      clear: (workspacePath: string) => raw.indexClear(workspacePath),
      updateEmbeddingConfig: (workspacePath: string, config: Parameters<typeof raw.indexUpdateEmbeddingConfig>[1]) => 
        raw.indexUpdateEmbeddingConfig(workspacePath, config),
      testConnection: (workspacePath: string) => raw.indexTestConnection(workspacePath),
      getProviders: () => raw.indexGetProviders(),
      onProgress: (callback: Parameters<typeof raw.onIndexProgress>[0]) => raw.onIndexProgress(callback),
    },

    // HTTP
    http: {
      readUrl: (url: string, timeout?: number) => raw.httpReadUrl(url, timeout),
      webSearch: (query: string, maxResults?: number) => raw.httpWebSearch(query, maxResults),
      setGoogleSearch: (apiKey: string, cx: string) => raw.httpSetGoogleSearch(apiKey, cx),
    },

    // 资源
    resources: {
      readJson: <T = unknown>(relativePath: string) => raw.resourcesReadJson<T>(relativePath),
      readText: (relativePath: string) => raw.resourcesReadText(relativePath),
      exists: (relativePath: string) => raw.resourcesExists(relativePath),
      clearCache: (prefix?: string) => raw.resourcesClearCache(prefix),
    },

    // MCP
    mcp: {
      initialize: (workspaceRoots: string[]) => raw.mcpInitialize(workspaceRoots),
      getServersState: () => raw.mcpGetServersState(),
      getAllTools: () => raw.mcpGetAllTools(),
      connectServer: (serverId: string) => raw.mcpConnectServer(serverId),
      disconnectServer: (serverId: string) => raw.mcpDisconnectServer(serverId),
      reconnectServer: (serverId: string) => raw.mcpReconnectServer(serverId),
      callTool: (request: Parameters<typeof raw.mcpCallTool>[0]) => raw.mcpCallTool(request),
      readResource: (request: Parameters<typeof raw.mcpReadResource>[0]) => raw.mcpReadResource(request),
      getPrompt: (request: Parameters<typeof raw.mcpGetPrompt>[0]) => raw.mcpGetPrompt(request),
      refreshCapabilities: (serverId: string) => raw.mcpRefreshCapabilities(serverId),
      getConfigPaths: () => raw.mcpGetConfigPaths(),
      reloadConfig: () => raw.mcpReloadConfig(),
      addServer: (config: Parameters<typeof raw.mcpAddServer>[0]) => raw.mcpAddServer(config),
      removeServer: (serverId: string) => raw.mcpRemoveServer(serverId),
      toggleServer: (serverId: string, disabled: boolean) => raw.mcpToggleServer(serverId, disabled),
      setAutoConnect: (enabled: boolean) => raw.mcpSetAutoConnect(enabled),
      startOAuth: (serverId: string) => raw.mcpStartOAuth(serverId),
      finishOAuth: (serverId: string, authorizationCode: string) => raw.mcpFinishOAuth(serverId, authorizationCode),
      refreshOAuthToken: (serverId: string) => raw.mcpRefreshOAuthToken(serverId),
      onServerStatus: (callback: Parameters<typeof raw.onMcpServerStatus>[0]) => raw.onMcpServerStatus(callback),
      onToolsUpdated: (callback: Parameters<typeof raw.onMcpToolsUpdated>[0]) => raw.onMcpToolsUpdated(callback),
      onResourcesUpdated: (callback: Parameters<typeof raw.onMcpResourcesUpdated>[0]) => raw.onMcpResourcesUpdated(callback),
      onStateChanged: (callback: Parameters<typeof raw.onMcpStateChanged>[0]) => raw.onMcpStateChanged(callback),
    },

    // LSP
    lsp: {
      start: (workspacePath: string) => raw.lspStart(workspacePath),
      stop: () => raw.lspStop(),
      didOpen: (params: Parameters<typeof raw.lspDidOpen>[0]) => raw.lspDidOpen(params),
      didChange: (params: Parameters<typeof raw.lspDidChange>[0]) => raw.lspDidChange(params),
      didClose: (params: Parameters<typeof raw.lspDidClose>[0]) => raw.lspDidClose(params),
      didSave: (params: Parameters<typeof raw.lspDidSave>[0]) => raw.lspDidSave(params),
      definition: (params: Parameters<typeof raw.lspDefinition>[0]) => raw.lspDefinition(params),
      typeDefinition: (params: Parameters<typeof raw.lspTypeDefinition>[0]) => raw.lspTypeDefinition(params),
      implementation: (params: Parameters<typeof raw.lspImplementation>[0]) => raw.lspImplementation(params),
      references: (params: Parameters<typeof raw.lspReferences>[0]) => raw.lspReferences(params),
      hover: (params: Parameters<typeof raw.lspHover>[0]) => raw.lspHover(params),
      completion: (params: Parameters<typeof raw.lspCompletion>[0]) => raw.lspCompletion(params),
      completionResolve: (item: Parameters<typeof raw.lspCompletionResolve>[0]) => raw.lspCompletionResolve(item),
      signatureHelp: (params: Parameters<typeof raw.lspSignatureHelp>[0]) => raw.lspSignatureHelp(params),
      rename: (params: Parameters<typeof raw.lspRename>[0]) => raw.lspRename(params),
      prepareRename: (params: Parameters<typeof raw.lspPrepareRename>[0]) => raw.lspPrepareRename(params),
      documentSymbol: (params: Parameters<typeof raw.lspDocumentSymbol>[0]) => raw.lspDocumentSymbol(params),
      workspaceSymbol: (params: Parameters<typeof raw.lspWorkspaceSymbol>[0]) => raw.lspWorkspaceSymbol(params),
      codeAction: (params: Parameters<typeof raw.lspCodeAction>[0]) => raw.lspCodeAction(params),
      formatting: (params: Parameters<typeof raw.lspFormatting>[0]) => raw.lspFormatting(params),
      rangeFormatting: (params: Parameters<typeof raw.lspRangeFormatting>[0]) => raw.lspRangeFormatting(params),
      documentHighlight: (params: Parameters<typeof raw.lspDocumentHighlight>[0]) => raw.lspDocumentHighlight(params),
      foldingRange: (params: Parameters<typeof raw.lspFoldingRange>[0]) => raw.lspFoldingRange(params),
      inlayHint: (params: Parameters<typeof raw.lspInlayHint>[0]) => raw.lspInlayHint(params),
      getDiagnostics: (filePath: string) => raw.getLspDiagnostics(filePath),
      onDiagnostics: (callback: Parameters<typeof raw.onLspDiagnostics>[0]) => raw.onLspDiagnostics(callback),
      // 新增 LSP 功能
      prepareCallHierarchy: (params: Parameters<typeof raw.lspPrepareCallHierarchy>[0]) => raw.lspPrepareCallHierarchy(params),
      incomingCalls: (params: Parameters<typeof raw.lspIncomingCalls>[0]) => raw.lspIncomingCalls(params),
      outgoingCalls: (params: Parameters<typeof raw.lspOutgoingCalls>[0]) => raw.lspOutgoingCalls(params),
      waitForDiagnostics: (params: Parameters<typeof raw.lspWaitForDiagnostics>[0]) => raw.lspWaitForDiagnostics(params),
      findBestRoot: (params: Parameters<typeof raw.lspFindBestRoot>[0]) => raw.lspFindBestRoot(params),
      ensureServerForFile: (params: Parameters<typeof raw.lspEnsureServerForFile>[0]) => raw.lspEnsureServerForFile(params),
      didChangeWatchedFiles: (params: Parameters<typeof raw.lspDidChangeWatchedFiles>[0]) => raw.lspDidChangeWatchedFiles(params),
      getSupportedLanguages: () => raw.lspGetSupportedLanguages(),
      // LSP 服务器安装管理
      getServerStatus: () => raw.lspGetServerStatus(),
      getBinDir: () => raw.lspGetBinDir(),
      getDefaultBinDir: () => raw.lspGetDefaultBinDir(),
      setCustomBinDir: (customPath: string | null) => raw.lspSetCustomBinDir(customPath),
      installServer: (serverType: string) => raw.lspInstallServer(serverType),
      installBasicServers: () => raw.lspInstallBasicServers(),
    },

    // Debug
    debug: {
      createSession: (config: Parameters<typeof raw.debugCreateSession>[0]) => raw.debugCreateSession(config),
      launch: (sessionId: string) => raw.debugLaunch(sessionId),
      attach: (sessionId: string) => raw.debugAttach(sessionId),
      stop: (sessionId: string) => raw.debugStop(sessionId),
      continue: (sessionId: string) => raw.debugContinue(sessionId),
      stepOver: (sessionId: string) => raw.debugStepOver(sessionId),
      stepInto: (sessionId: string) => raw.debugStepInto(sessionId),
      stepOut: (sessionId: string) => raw.debugStepOut(sessionId),
      pause: (sessionId: string) => raw.debugPause(sessionId),
      setBreakpoints: (sessionId: string, file: string, breakpoints: Parameters<typeof raw.debugSetBreakpoints>[2]) => 
        raw.debugSetBreakpoints(sessionId, file, breakpoints),
      getStackTrace: (sessionId: string, threadId: number) => raw.debugGetStackTrace(sessionId, threadId),
      getScopes: (sessionId: string, frameId: number) => raw.debugGetScopes(sessionId, frameId),
      getVariables: (sessionId: string, variablesReference: number) => raw.debugGetVariables(sessionId, variablesReference),
      evaluate: (sessionId: string, expression: string, frameId?: number) => raw.debugEvaluate(sessionId, expression, frameId),
      getSessionState: (sessionId: string) => raw.debugGetSessionState(sessionId),
      getAllSessions: () => raw.debugGetAllSessions(),
      onEvent: (callback: Parameters<typeof raw.onDebugEvent>[0]) => raw.onDebugEvent(callback),
    },

    // 更新服务
    updater: {
      check: () => raw.updaterCheck(),
      getStatus: () => raw.updaterGetStatus(),
      download: () => raw.updaterDownload(),
      install: () => raw.updaterInstall(),
      openDownloadPage: (url?: string) => raw.updaterOpenDownloadPage(url),
      onStatus: (callback: Parameters<typeof raw.onUpdaterStatus>[0]) => raw.onUpdaterStatus(callback),
    },

    // 应用错误（来自主进程）
    app: {
      onError: (callback: Parameters<typeof raw.onAppError>[0]) => raw.onAppError(callback),
    },

    // 命令执行
    onExecuteCommand: (callback: Parameters<typeof raw.onExecuteCommand>[0]) => raw.onExecuteCommand(callback),
  }
}

// 延迟初始化
let _api: ReturnType<typeof createGroupedAPI> | null = null

/**
 * 获取分组的 Electron API
 */
export function getAPI() {
  if (!_api) {
    _api = createGroupedAPI()
  }
  return _api
}

// 类型从实现推断
export type GroupedElectronAPI = ReturnType<typeof createGroupedAPI>

// 便捷访问
export const api = new Proxy({} as GroupedElectronAPI, {
  get(_, prop) {
    return getAPI()[prop as keyof GroupedElectronAPI]
  },
})
