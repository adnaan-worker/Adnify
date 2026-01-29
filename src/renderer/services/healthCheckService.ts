/**
 * Provider 健康检查服务
 * 检测 LLM API 连通性和配置有效性
 */

import { CacheService } from '@shared/utils/CacheService'
import { toAppError } from '@shared/utils/errorHandler'
import { getCacheConfig } from '@shared/config/agentConfig'
import { getEditorConfig } from '@renderer/settings'

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
 */
export async function checkProviderHealth(
    provider: string,
    apiKey: string,
    baseUrl?: string
): Promise<HealthCheckResult> {
    const startTime = Date.now()

    const defaultUrls: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com/v1',
        deepseek: 'https://api.deepseek.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        mistral: 'https://api.mistral.ai/v1',
        ollama: 'http://localhost:11434/v1'
    }

    const url = baseUrl || defaultUrls[provider] || defaultUrls.openai

    try {
        const response = await fetch(`${url}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(getEditorConfig().performance.healthCheckTimeoutMs)
        })

        const latency = Date.now() - startTime

        if (response.ok) {
            const result: HealthCheckResult = {
                provider,
                status: 'healthy',
                latency,
                checkedAt: new Date()
            }
            healthCache.set(provider, result)
            return result
        } else {
            const result: HealthCheckResult = {
                provider,
                status: 'unhealthy',
                latency,
                error: `HTTP ${response.status}`,
                checkedAt: new Date()
            }
            healthCache.set(provider, result)
            return result
        }
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
 * 获取缓存统计
 */
export function getHealthCacheStats() {
    return healthCache.getStats()
}
