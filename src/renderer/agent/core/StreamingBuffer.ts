/**
 * 流式响应节流优化
 * 使用 requestAnimationFrame 批量更新流式内容，减少状态更新频率
 */

export class StreamingBuffer {
    private buffer: Map<string, string> = new Map() // messageId -> pending content
    private rafId: number | null = null
    private flushCallback: ((messageId: string, content: string) => void) | null = null

    constructor(callback?: (messageId: string, content: string) => void) {
        if (callback) {
            this.flushCallback = callback
        }
    }

    setFlushCallback(callback: (messageId: string, content: string) => void) {
        this.flushCallback = callback
    }

    append(messageId: string, content: string): void {
        const existing = this.buffer.get(messageId) || ''
        this.buffer.set(messageId, existing + content)
        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        if (this.rafId) return // 已有待执行的刷新
        this.rafId = requestAnimationFrame(() => {
            this.flush()
            this.rafId = null
        })
    }

    private flush(): void {
        if (!this.flushCallback) return
        this.buffer.forEach((content, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content)
            }
        })
        this.buffer.clear()
    }

    // 立即刷新（用于流式结束时）
    flushNow(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.buffer.clear()
    }
}
