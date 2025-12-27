/**
 * SSE (Server-Sent Events) 通用解析器
 * 
 * 支持:
 * - 标准 SSE 格式 (data: xxx)
 * - 自定义前缀
 * - 自定义结束标记
 * - 事件类型解析 (event: xxx)
 */

/** SSE 解析配置 */
export interface SSEConfig {
  dataPrefix?: string
  doneMarker: string
  eventField?: string
}

/** SSE 事件类型 */
export type SSEEventType = 'data' | 'done' | 'error' | 'event'

/** SSE 事件 */
export interface SSEEvent {
    type: SSEEventType
    data?: unknown
    eventType?: string  // 原始事件类型 (如 Anthropic 的 message_start)
    raw?: string        // 原始数据行
}

/** 默认 SSE 配置 */
const DEFAULT_SSE_CONFIG: SSEConfig = {
    dataPrefix: 'data: ',
    doneMarker: '[DONE]',
}

/**
 * 解析 SSE 流
 * 
 * @param response HTTP Response 对象
 * @param config SSE 解析配置
 * @yields SSE 事件
 */
export async function* parseSSEStream(
    response: Response,
    config: SSEConfig = DEFAULT_SSE_CONFIG
): AsyncGenerator<SSEEvent> {
    if (!response.body) {
        yield { type: 'error', data: 'Response body is null' }
        return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    const dataPrefix = config.dataPrefix ?? 'data: '
    const doneMarker = config.doneMarker

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })

            // 按行分割处理
            const lines = buffer.split('\n')
            buffer = lines.pop() || '' // 保留最后一个不完整的行

            for (const line of lines) {
                const trimmedLine = line.trim()
                if (!trimmedLine) continue

                // 检查 event: 行 (用于 Anthropic 等)
                if (trimmedLine.startsWith('event: ')) {
                    const eventType = trimmedLine.slice(7).trim()
                    // 检查是否为结束事件
                    if (eventType === doneMarker || eventType === 'message_stop') {
                        yield { type: 'done', eventType }
                        return
                    }
                    yield { type: 'event', eventType, raw: trimmedLine }
                    continue
                }

                // 检查 data: 行
                if (trimmedLine.startsWith(dataPrefix)) {
                    const data = trimmedLine.slice(dataPrefix.length)

                    // 检查是否为结束标记
                    if (data === doneMarker) {
                        yield { type: 'done', raw: trimmedLine }
                        return
                    }

                    // 尝试解析 JSON
                    try {
                        const parsed = JSON.parse(data)
                        yield { type: 'data', data: parsed, raw: trimmedLine }
                    } catch {
                        // 非 JSON 数据，返回原始字符串
                        yield { type: 'data', data, raw: trimmedLine }
                    }
                }
            }
        }

        // 处理剩余的 buffer
        if (buffer.trim()) {
            const trimmedLine = buffer.trim()
            if (trimmedLine.startsWith(dataPrefix)) {
                const data = trimmedLine.slice(dataPrefix.length)
                if (data !== doneMarker) {
                    try {
                        const parsed = JSON.parse(data)
                        yield { type: 'data', data: parsed, raw: trimmedLine }
                    } catch {
                        yield { type: 'data', data, raw: trimmedLine }
                    }
                }
            }
        }
    } catch (error) {
        yield { type: 'error', data: error instanceof Error ? error.message : String(error) }
    } finally {
        reader.releaseLock()
    }
}

/**
 * 简单的 SSE 行解析器 (非流式)
 * 用于测试或处理已经完整的 SSE 数据
 */
export function parseSSELine(
    line: string,
    config: SSEConfig = DEFAULT_SSE_CONFIG
): SSEEvent | null {
    const trimmedLine = line.trim()
    if (!trimmedLine) return null

    const dataPrefix = config.dataPrefix ?? 'data: '
    const doneMarker = config.doneMarker

    // event: 行
    if (trimmedLine.startsWith('event: ')) {
        const eventType = trimmedLine.slice(7).trim()
        if (eventType === doneMarker || eventType === 'message_stop') {
            return { type: 'done', eventType }
        }
        return { type: 'event', eventType, raw: trimmedLine }
    }

    // data: 行
    if (trimmedLine.startsWith(dataPrefix)) {
        const data = trimmedLine.slice(dataPrefix.length)

        if (data === doneMarker) {
            return { type: 'done', raw: trimmedLine }
        }

        try {
            const parsed = JSON.parse(data)
            return { type: 'data', data: parsed, raw: trimmedLine }
        } catch {
            return { type: 'data', data, raw: trimmedLine }
        }
    }

    return null
}
