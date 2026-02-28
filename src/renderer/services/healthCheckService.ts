/**
 * Provider 健康检查服务
 * 检测 LLM API 连通性和配置有效性
 */

import { CacheService } from '@shared/utils/CacheService'
import { toAppError } from '@shared/utils/errorHandler'
import { getCacheConfig } from '@shared/config/agentConfig'
import { getEditorConfig } from '@renderer/settings'
import { LLMConfig } from '@shared/types/llm'

export interface HealthCheckResult {
    provider: string
    status: 'healthy' | 'unhealthy' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
}

// 使用统一缓存
const cacheConfig = getCacheConfig('healthCheck')
const healthCache = new CacheService<HealthCheckResult>('HealthCheck', {
    maxSize: cacheConfig.maxSize,
    defaultTTL: cacheConfig.ttlMs,
    evictionPolicy: cacheConfig.evictionPolicy || 'fifo',
})

/**
 * 检查单个 Provider 的健康状态
 * 通过主进程执行以避免 CORS 问题
 */
export async function checkProviderHealth(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    protocol?: string
): Promise<HealthCheckResult> {
    try {
        const timeout = getEditorConfig().performance.healthCheckTimeoutMs
        const result = await window.electronAPI.healthCheckProvider(
            provider,
            apiKey,
            baseUrl,
            timeout,
            protocol
        )

        // 将 checkedAt 从字符串转换回 Date 对象
        result.checkedAt = new Date(result.checkedAt)

        healthCache.set(provider, result)
        return result
    } catch (err) {
        const result: HealthCheckResult = {
            provider,
            status: 'unhealthy',
            error: toAppError(err).message || 'Connection failed',
            checkedAt: new Date()
        }
        healthCache.set(provider, result)
        return result
    }
}

/**
 * 获取缓存的健康检查结果
 */
export function getCachedHealthStatus(provider: string): HealthCheckResult | null {
    return healthCache.get(provider) ?? null
}

/**
 * 清除健康检查缓存
 */
export function clearHealthCache() {
    healthCache.clear()
}

/**
 * 获取所有缓存的健康检查结果
 */
export function getAllHealthStatus(): HealthCheckResult[] {
    return healthCache.values()
}

/**
 * 测试模型调用
 */
export async function testModelCall(config: LLMConfig) {
    try {
        const result = await window.electronAPI.testModel(config)
        return result
    } catch (err) {
        return {
            success: false,
            error: toAppError(err).message || 'Test failed',
        }
    }
}

/**
 * 拉取模型列表
 */
export async function fetchModelsCall(provider: string, apiKey: string, baseUrl?: string, protocol?: string) {
    try {
        const result = await window.electronAPI.fetchModels(provider, apiKey, baseUrl, protocol)
        return result
    } catch (err) {
        return {
            success: false,
            error: toAppError(err).message || 'Fetch failed',
        }
    }
}

/**
 * 获取缓存统计
 */
export function getHealthCacheStats() {
    return healthCache.getStats()
}
