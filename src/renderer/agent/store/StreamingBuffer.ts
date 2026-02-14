/**
 * 流式响应节流缓冲区
 * 
 * 用于优化高频更新，通过 requestAnimationFrame 实现约 60fps 的批量更新
 * 减少 React 渲染次数，提升性能
 */

type FlushCallback = (messageId: string, content: string, threadId?: string) => void

class StreamingBuffer {
    private buffer: Map<string, { content: string; threadId?: string }> = new Map()
    private rafId: number | null = null
    private flushCallback: FlushCallback | null = null

    setFlushCallback(callback: FlushCallback) {
        this.flushCallback = callback
    }

    append(messageId: string, content: string, threadId?: string): void {
        if (!content) return
        
        const isFirstData = !this.buffer.has(messageId)
        const existing = this.buffer.get(messageId)
        
        if (existing) {
            this.buffer.set(messageId, {
                content: existing.content + content,
                threadId: threadId || existing.threadId
            })
        } else {
            this.buffer.set(messageId, { content, threadId })
        }
        
        // 优化：第一次数据立即刷新，后续数据节流
        if (isFirstData) {
            this.flushNow()
        } else {
            this.scheduleFlush()
        }
    }

    private scheduleFlush(): void {
        if (this.rafId !== null) return

        // 简化逻辑：直接在下一帧刷新，不做复杂的时间判断
        // requestAnimationFrame 本身就提供了约 60fps 的节流
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null
            this.flush()
        })
    }

    private flush(): void {
        if (!this.flushCallback || this.buffer.size === 0) return

        const updates = new Map(this.buffer)
        this.buffer.clear()

        updates.forEach(({ content, threadId }, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content, threadId)
            }
        })
    }

    flushNow(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.buffer.clear()
    }
}

// 单例实例
export const streamingBuffer = new StreamingBuffer()

// 导出刷新函数，供外部在关键时刻调用
export function flushStreamingBuffer(): void {
    streamingBuffer.flushNow()
}
