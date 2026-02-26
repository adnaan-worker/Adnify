/**
 * 旧 config.json → 新三文件结构迁移
 * 
 * 将单一 config.json 拆分为：
 * - credentials.json — API keys、provider 凭证
 * - preferences.json — 用户偏好、agent/editor/security 配置
 * - workspace-meta.json — 工作区历史、embedding 配置
 * 
 * 迁移完成后删除旧 config.json
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import type Store from 'electron-store'

// 凭证字段（provider 级别）
const CREDENTIAL_FIELDS = ['apiKey', 'baseUrl', 'timeout', 'headers'] as const

// workspace-meta 顶层 key
const WORKSPACE_META_KEYS = [
    'lastWorkspacePath',
    'lastWorkspaceSession',
    'recentWorkspaces',
    'embeddingConfig',
    'indexOptions',
] as const

/**
 * 检测并执行迁移
 * 
 * @returns true 如果执行了迁移
 */
export function migrateLegacyConfig(
    configDir: string,
    credentialsStore: Store,
    preferencesStore: Store,
    workspaceMetaStore: Store,
): boolean {
    const legacyPath = path.join(configDir, 'config.json')

    if (!fs.existsSync(legacyPath)) {
        return false
    }

    // 如果目标文件已存在，说明已迁移，跳过
    const credentialsPath = path.join(configDir, 'credentials.json')
    if (fs.existsSync(credentialsPath)) {
        // 已迁移但旧文件未删除，直接删
        try { fs.unlinkSync(legacyPath) } catch { /* ignore */ }
        return false
    }

    try {
        const raw = fs.readFileSync(legacyPath, 'utf-8')
        const legacy = JSON.parse(raw) as Record<string, unknown>

        // ---- 提取凭证 ----
        const credentialsData: Record<string, unknown> = {}
        const appSettings = (legacy['app-settings'] || {}) as Record<string, unknown>
        const providerConfigs = (appSettings.providerConfigs || {}) as Record<string, Record<string, unknown>>

        // 从 providerConfigs 提取凭证（apiKey, baseUrl 等）
        const cleanedProviders: Record<string, Record<string, unknown>> = {}
        const preferencesProviders: Record<string, Record<string, unknown>> = {}

        for (const [id, config] of Object.entries(providerConfigs)) {
            const cred: Record<string, unknown> = {}
            const pref: Record<string, unknown> = {}

            for (const [key, value] of Object.entries(config)) {
                if ((CREDENTIAL_FIELDS as readonly string[]).includes(key)) {
                    cred[key] = value
                } else {
                    pref[key] = value
                }
            }

            if (Object.keys(cred).length > 0) cleanedProviders[id] = cred
            if (Object.keys(pref).length > 0) preferencesProviders[id] = pref
        }

        credentialsData.providerConfigs = cleanedProviders

        // ---- 提取偏好 ----
        const preferencesData: Record<string, unknown> = {}

        // 从 app-settings 提取（排除 providerConfigs）
        const { providerConfigs: _, ...appSettingsRest } = appSettings
        preferencesData['app-settings'] = {
            ...appSettingsRest,
            // 保留非凭证的 provider 配置（customModels, protocol, displayName 等）
            providerConfigs: preferencesProviders,
        }

        // 顶层偏好 key
        if (legacy.themeId !== undefined) preferencesData.themeId = legacy.themeId
        if (legacy.currentTheme !== undefined) preferencesData.currentTheme = legacy.currentTheme
        if (legacy.customThemes !== undefined) preferencesData.customThemes = legacy.customThemes
        // editorConfig 和 securitySettings 可能直接在顶层
        if (legacy.editorConfig !== undefined) preferencesData.editorConfig = legacy.editorConfig
        if (legacy.securitySettings !== undefined) preferencesData.securitySettings = legacy.securitySettings
        // LSP
        if (legacy.lspSettings !== undefined) preferencesData.lspSettings = legacy.lspSettings

        // ---- 提取工作区元数据 ----
        const workspaceData: Record<string, unknown> = {}
        for (const key of WORKSPACE_META_KEYS) {
            if (legacy[key] !== undefined) {
                workspaceData[key] = legacy[key]
            }
        }

        // ---- 写入新 store ----
        credentialsStore.store = credentialsData
        preferencesStore.store = preferencesData
        workspaceMetaStore.store = workspaceData

        // ---- 删除旧文件 ----
        fs.unlinkSync(legacyPath)

        logger.system.info('[ConfigMigration] Successfully migrated config.json to split stores')
        return true
    } catch (error) {
        logger.system.error('[ConfigMigration] Migration failed:', error)
        return false
    }
}
