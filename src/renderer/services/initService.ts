/**
 * 应用初始化服务
 * 将初始化逻辑从 App.tsx 抽离，提供更清晰的启动流程
 */

import { api } from './electronAPI'
import { logger } from '@utils/Logger'
import { startupMetrics } from '@shared/utils/startupMetrics'
import { useStore } from '../store'
import { useAgentStore, initializeAgentStore } from '@renderer/agent/store/AgentStore'
import { settingsService } from '@renderer/settings'
import { themeManager } from '../config/themeConfig'
import { keybindingService } from './keybindingService'
import { registerCoreCommands } from '../config/commands'
import { adnifyDir } from './adnifyDirService'
import { checkpointService } from '@renderer/agent/services/checkpointService'
import { initDiagnosticsListener } from './diagnosticsStore'
import { restoreWorkspaceState } from './workspaceStateService'
import { mcpService } from './mcpService'
import { snippetService } from './snippetService'
import { workerService } from './workerService'

export interface InitResult {
  success: boolean
  shouldShowOnboarding: boolean
  error?: string
}

/**
 * 使用 requestIdleCallback 延迟执行非关键任务
 */
function scheduleIdleTask(task: () => void | Promise<void>, timeout = 2000): void {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => { task() }, { timeout })
  } else {
    setTimeout(task, 100)
  }
}

/**
 * 第一阶段：核心模块初始化（阻塞）
 * 这些模块必须在 UI 渲染前完成
 */
async function initCoreModules(): Promise<void> {
  startupMetrics.start('init-core')
  
  // 同步注册命令（非常快）
  registerCoreCommands()
  
  // 并行初始化核心模块
  await Promise.all([
    keybindingService.init(),
    initializeAgentStore(),
    settingsService.loadAll(), // 初始化设置服务
    themeManager.init(),
    snippetService.init(), // snippet 必须在编辑器可用前初始化
  ])
  
  startupMetrics.end('init-core')
}

/**
 * 第二阶段：加载用户设置
 */
async function loadUserSettings(isEmptyWindow: boolean): Promise<string | null> {
  startupMetrics.start('load-settings')

  const [, savedTheme] = await Promise.all([
    useStore.getState().loadSettings(isEmptyWindow),
    api.settings.get('currentTheme'),
  ])

  startupMetrics.end('load-settings')
  return savedTheme as string | null
}

/**
 * 第三阶段：恢复工作区
 */
async function restoreWorkspace(): Promise<boolean> {
  startupMetrics.start('restore-workspace')

  const workspaceConfig = await api.workspace.restore()
  if (!workspaceConfig?.roots?.length) {
    startupMetrics.end('restore-workspace')
    return false
  }

  const { setWorkspace, setFiles } = useStore.getState()
  setWorkspace(workspaceConfig)

  // 并行初始化工作区相关内容
  const [, , items] = await Promise.all([
    Promise.all(workspaceConfig.roots.map(root => adnifyDir.initialize(root))),
    adnifyDir.setPrimaryRoot(workspaceConfig.roots[0]),
    api.file.readDir(workspaceConfig.roots[0]),
  ])

  setFiles(items)
  
  // 初始化诊断监听器（同步，很快）
  initDiagnosticsListener()
  
  // 恢复编辑器状态
  await restoreWorkspaceState()
  
  // 初始化 MCP 服务
  await mcpService.initialize(workspaceConfig.roots)
  
  startupMetrics.end('restore-workspace')
  return true
}

/**
 * 第四阶段：后台初始化（非阻塞）
 * 使用 requestIdleCallback 延迟执行
 */
function scheduleBackgroundInit(): void {
  // Checkpoint 服务初始化
  scheduleIdleTask(async () => {
    try {
      await checkpointService.init()
      logger.system.debug('[Init] Checkpoint service initialized')
    } catch (e) {
      logger.system.warn('[Init] Checkpoint service init failed:', e)
    }
  })

  // Agent Store 持久化恢复
  scheduleIdleTask(async () => {
    try {
      await useAgentStore.persist.rehydrate()
      logger.system.debug('[Init] Agent store rehydrated')
    } catch (e) {
      logger.system.warn('[Init] Agent store rehydrate failed:', e)
    }
  })

  // Worker 服务初始化
  scheduleIdleTask(() => {
    try {
      workerService.init()
      logger.system.debug('[Init] Worker service initialized')
    } catch (e) {
      logger.system.warn('[Init] Worker service init failed:', e)
    }
  })
}

/**
 * 主初始化函数
 */
export async function initializeApp(
  updateStatus: (status: string) => void
): Promise<InitResult> {
  try {
    startupMetrics.start('init-total')
    
    // 第一阶段：核心模块
    updateStatus('Initializing...')
    await initCoreModules()
    
    // 第二阶段：用户设置
    updateStatus('Loading settings...')
    const params = new URLSearchParams(window.location.search)
    const isEmptyWindow = params.get('empty') === '1'
    const savedTheme = await loadUserSettings(isEmptyWindow)
    
    // 应用主题
    if (savedTheme) {
      useStore.getState().setTheme(savedTheme as any)
    }
    
    // 获取引导状态
    const { onboardingCompleted, hasExistingConfig } = useStore.getState()
    
    // 第三阶段：恢复工作区
    if (!isEmptyWindow) {
      updateStatus('Restoring workspace...')
      await restoreWorkspace()
    }
    
    // 第四阶段：后台初始化（非阻塞）
    scheduleBackgroundInit()
    
    updateStatus('Ready!')
    startupMetrics.end('init-total')
    
    // 打印启动性能报告（开发环境）
    if (process.env.NODE_ENV === 'development') {
      startupMetrics.mark('app-ready')
      startupMetrics.printReport()
    }
    
    const shouldShowOnboarding = onboardingCompleted === false ||
      (onboardingCompleted === undefined && !hasExistingConfig)
    
    return { success: true, shouldShowOnboarding }
  } catch (error) {
    logger.system.error('[Init] Failed to initialize app:', error)
    // 确保基础功能可用
    registerCoreCommands()
    return {
      success: false,
      shouldShowOnboarding: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 注册设置同步监听器
 */
export function registerSettingsSync(): () => void {
  const { setLLMConfig, setLanguage, setAutoApprove, setPromptTemplateId, setTheme } = useStore.getState()

  return api.settings.onChanged(({ key, value }: { key: string; value: unknown }) => {
    logger.system.debug(`[Init] Setting changed: ${key}`)
    switch (key) {
      case 'llmConfig':
        setLLMConfig(value as any)
        break
      case 'language':
        setLanguage(value as any)
        break
      case 'autoApprove':
        setAutoApprove(value as any)
        break
      case 'promptTemplateId':
        setPromptTemplateId(value as any)
        break
      case 'currentTheme':
        setTheme(value as any)
        break
    }
  })
}
