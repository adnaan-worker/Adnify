/**
 * Health Check IPC Handlers
 * 在主进程中执行网络请求以避免 CORS 问题
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { createModel } from '../services/llm/modelFactory'
import { generateText } from 'ai'

export interface HealthCheckResult {
  provider: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  latency?: number
  error?: string
  checkedAt: Date
}

export interface ModelTestResult {
  success: boolean
  content?: string
  latency?: number
  error?: string
}

/**
 * 注册健康检查 IPC handlers
 */
export function registerHealthCheckHandlers() {
  ipcMain.handle('healthCheck:check', async (_, provider: string, apiKey: string, baseUrl?: string, timeout = 10000, protocol?: string) => {
    const startTime = Date.now()

    const defaultUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      gemini: 'https://generativelanguage.googleapis.com',
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      ollama: 'http://localhost:11434/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
    }

    const url = (baseUrl || defaultUrls[provider] || defaultUrls.openai).replace(/\/$/, '')
    const activeProtocol = protocol || (provider === 'gemini' ? 'google' : provider === 'anthropic' ? 'anthropic' : 'openai')

    try {
      logger.ipc.info(`[HealthCheck] Checking ${provider} at ${url} (protocol: ${activeProtocol})`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      let fetchUrl: string
      let headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (activeProtocol === 'google') {
        // Google Gemini: GET /v1beta/models?key=
        fetchUrl = url.includes('/v1') ? `${url}/models` : `${url}/v1beta/models`
        if (apiKey) fetchUrl += `?key=${apiKey}`
      } else if (activeProtocol === 'anthropic') {
        // Anthropic: GET /v1/messages 不可用，改用简单的模型列表或 POST 测试
        // 尝试 /v1/models（较新版本支持）
        fetchUrl = `${url}/v1/models`
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        // OpenAI / OpenAI-Responses / 其他兼容协议: GET /models
        fetchUrl = `${url}/models`
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const latency = Date.now() - startTime

      if (response.ok) {
        logger.ipc.info(`[HealthCheck] ${provider} is healthy (${latency}ms)`)
        return { provider, status: 'healthy', latency, checkedAt: new Date() } as HealthCheckResult
      } else {
        logger.ipc.warn(`[HealthCheck] ${provider} returned HTTP ${response.status}`)
        return { provider, status: 'unhealthy', latency, error: `HTTP ${response.status}`, checkedAt: new Date() } as HealthCheckResult
      }
    } catch (err) {
      const error = toAppError(err)
      logger.ipc.error(`[HealthCheck] ${provider} check failed:`, error.message)
      return { provider, status: 'unhealthy', error: error.message || 'Connection failed', checkedAt: new Date() } as HealthCheckResult
    }
  })

  ipcMain.handle('healthCheck:testModel', async (_, config: any) => {
    const startTime = Date.now()
    try {
      if (!config || !config.provider || !config.model) {
        throw new Error('Invalid model configuration: missing provider or model')
      }

      logger.ipc.info(`[ModelTest] Testing model ${config.model} for provider ${config.provider}`)

      const model = createModel(config)
      const { text } = await generateText({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 10,
      })

      const latency = Date.now() - startTime
      logger.ipc.info(`[ModelTest] Success: ${text.slice(0, 20)}... (${latency}ms)`)

      return {
        success: true,
        content: text,
        latency,
      }
    } catch (err) {
      const error = toAppError(err)
      const latency = Date.now() - startTime
      logger.ipc.error(`[ModelTest] Failed:`, error.message)
      return {
        success: false,
        error: error.message || 'Model test failed',
        latency,
      }
    }
  })

  ipcMain.handle('healthCheck:fetchModels', async (_, provider: string, apiKey: string, baseUrl?: string, protocol?: string) => {
    try {
      logger.ipc.info(`[HealthCheck] Fetching models for ${provider} (protocol: ${protocol})`)

      const defaultUrls: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        ollama: 'http://localhost:11434/v1',
      }

      let url = baseUrl || defaultUrls[provider] || defaultUrls.openai
      let fetchUrl = ''
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // 根据协议或提供商确定请求方式
      const activeProtocol = protocol || (provider === 'gemini' ? 'google' : provider === 'anthropic' ? 'anthropic' : 'openai')

      if (activeProtocol === 'google' || provider === 'gemini') {
        // Google Gemini API
        // 兼容处理：如果 baseUrl 包含 /v1beta，则直接使用
        const base = url.endsWith('/') ? url.slice(0, -1) : url
        fetchUrl = base.includes('/v1') ? `${base}/models` : `${base}/v1beta/models`
        if (apiKey) {
          fetchUrl += `?key=${apiKey}`
        }
      } else if (activeProtocol === 'anthropic') {
        // Anthropic
        const base = url.endsWith('/') ? url.slice(0, -1) : url
        fetchUrl = `${base}/v1/models`
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        // OpenAI / OpenAI-Responses / 其他兼容协议
        fetchUrl = `${url.endsWith('/') ? url.slice(0, -1) : url}/models`
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      logger.ipc.info(`[HealthCheck] Requesting models from: ${fetchUrl}`)

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const data = await response.json() as unknown
      let models: string[] = []

      if (activeProtocol === 'google' || provider === 'gemini') {
        if (data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)) {
          models = data.models.map((m: any) => m.name.replace('models/', ''))
        }
      } else {
        // OpenAI 格式
        if (data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
          models = data.data.map((m: any) => m.id)
        } else if (Array.isArray(data)) {
          // 某些非标准接口直接返回数组
          models = data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name))
        }
      }

      // 过滤掉不合法的空值并排序
      models = models.filter(Boolean).sort()

      logger.ipc.info(`[HealthCheck] Successfully fetched ${models.length} models`)
      return { success: true, models }

    } catch (err) {
      const error = toAppError(err)
      logger.ipc.error(`[HealthCheck] Fetch models failed:`, error.message)
      return { success: false, error: error.message }
    }
  })

  logger.ipc.info('[HealthCheck] Health check handlers registered')
}
