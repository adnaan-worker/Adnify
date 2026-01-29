/**
 * MCP 配置加载器
 * 负责加载和监听 MCP 配置文件
 * 支持本地和远程 MCP 服务器配置
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { getConfigFilePath, getWorkspaceConfigFilePath, CONFIG_FILES } from '../configPath'
import type { McpConfig, McpServerConfig } from '@shared/types/mcp'

export class McpConfigLoader {
  private workspaceRoots: string[] = []
  private watchers: fs.FSWatcher[] = []
  private onConfigChange?: () => void

  /** 获取用户配置路径 */
  private get userConfigPath(): string {
    return getConfigFilePath(CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 设置工作区根目录 */
  setWorkspaceRoots(roots: string[]): void {
    this.workspaceRoots = roots
    this.setupWatchers()
  }

  /** 设置配置变更回调 */
  setOnConfigChange(callback: () => void): void {
    this.onConfigChange = callback
  }

  /** 加载合并后的配置 */
  loadConfig(): McpServerConfig[] {
    const configs: McpServerConfig[] = []
    const seenIds = new Set<string>()

    // 1. 加载用户级配置（最低优先级）
    const userConfig = this.loadConfigFile(this.userConfigPath)
    if (userConfig) {
      for (const [id, serverConfig] of Object.entries(userConfig.mcpServers)) {
        if (!seenIds.has(id)) {
          configs.push({ id, ...serverConfig } as McpServerConfig)
          seenIds.add(id)
        }
      }
    }

    // 2. 加载工作区配置（后面的覆盖前面的）
    for (const root of this.workspaceRoots) {
      const workspaceConfigPath = this.getWorkspaceConfigPath(root)
      const workspaceConfig = this.loadConfigFile(workspaceConfigPath)
      
      if (workspaceConfig) {
        for (const [id, serverConfig] of Object.entries(workspaceConfig.mcpServers)) {
          // 移除旧配置
          const existingIndex = configs.findIndex(c => c.id === id)
          if (existingIndex !== -1) {
            configs.splice(existingIndex, 1)
          }
          // 添加新配置
          configs.push({ id, ...serverConfig } as McpServerConfig)
          seenIds.add(id)
        }
      }
    }

    logger.mcp?.info(`[McpConfigLoader] Loaded ${configs.length} MCP server configs`)
    return configs
  }

  /** 保存用户级配置 */
  async saveUserConfig(config: McpConfig): Promise<void> {
    await this.saveConfigFile(this.userConfigPath, config)
  }

  /** 保存工作区配置 */
  async saveWorkspaceConfig(workspaceRoot: string, config: McpConfig): Promise<void> {
    const configPath = this.getWorkspaceConfigPath(workspaceRoot)
    await this.saveConfigFile(configPath, config)
  }

  /** 获取用户配置路径 */
  getUserConfigPath(): string {
    return this.userConfigPath
  }

  /** 获取工作区配置路径 */
  getWorkspaceConfigPath(workspaceRoot: string): string {
    return getWorkspaceConfigFilePath(workspaceRoot, CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 添加服务器到用户配置 */
  async addServer(serverConfig: McpServerConfig): Promise<void> {
    const config = this.loadConfigFile(this.userConfigPath) || { mcpServers: {} }
    const { id, ...rest } = serverConfig
    config.mcpServers[id] = rest
    await this.saveConfigFile(this.userConfigPath, config)
  }

  /** 从用户配置删除服务器 */
  async removeServer(serverId: string): Promise<void> {
    const config = this.loadConfigFile(this.userConfigPath)
    if (config && config.mcpServers[serverId]) {
      delete config.mcpServers[serverId]
      await this.saveConfigFile(this.userConfigPath, config)
    }
  }

  /** 切换服务器启用/禁用状态 */
  async toggleServer(serverId: string, disabled: boolean): Promise<void> {
    const config = this.loadConfigFile(this.userConfigPath)
    if (config && config.mcpServers[serverId]) {
      config.mcpServers[serverId].disabled = disabled
      await this.saveConfigFile(this.userConfigPath, config)
    }
  }

  /** 清理资源 */
  cleanup(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
  }

  // =================== 私有方法 ===================

  private loadConfigFile(filePath: string): McpConfig | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      const config = JSON.parse(content) as McpConfig

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        logger.mcp?.warn(`[McpConfigLoader] Invalid config format: ${filePath}`)
        return null
      }

      return config
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to load config: ${filePath} - ${error.code}`, error)
      return null
    }
  }

  private async saveConfigFile(filePath: string, config: McpConfig): Promise<void> {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const content = JSON.stringify(config, null, 2)
      fs.writeFileSync(filePath, content, 'utf-8')
      logger.mcp?.info(`[McpConfigLoader] Saved config: ${filePath}`)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to save config: ${filePath} - ${error.code}`, error)
      throw error
    }
  }

  private setupWatchers(): void {
    // 清理旧的 watchers
    this.cleanup()

    // 监听用户配置
    this.watchConfigFile(this.userConfigPath)

    // 监听工作区配置
    for (const root of this.workspaceRoots) {
      const configPath = this.getWorkspaceConfigPath(root)
      this.watchConfigFile(configPath)
    }
  }

  private watchConfigFile(filePath: string): void {
    const dir = path.dirname(filePath)
    const filename = path.basename(filePath)
    
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        return
      }
    }

    try {
      const watcher = fs.watch(dir, (_eventType, changedFilename) => {
        if (changedFilename === filename) {
          logger.mcp?.info(`[McpConfigLoader] Config changed: ${filePath}`)
          // 延迟触发，避免频繁更新
          setTimeout(() => {
            this.onConfigChange?.()
          }, 500)
        }
      })

      this.watchers.push(watcher)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.warn(`[McpConfigLoader] Failed to watch: ${dir} - ${error.code}`, error)
    }
  }
}
