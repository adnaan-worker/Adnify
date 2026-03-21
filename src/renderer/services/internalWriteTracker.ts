/**
 * 内部写入追踪器
 * 追踪由应用内部（Agent 工具、Composer、Checkpoint 等）发起的文件写入，
 * 防止 fileWatcher 将其误判为"外部修改"并弹出 confirm 对话框。
 *
 * 用法：
 *   写入前：internalWriteTracker.mark(path)
 *   fileWatcher 中：internalWriteTracker.consume(path) → true 表示是内部写入
 */

const EXPIRY_MS = 5_000 // 5 秒后自动过期，防止泄漏

const pending = new Map<string, ReturnType<typeof setTimeout>>()

function normalize(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase()
}

/** 标记即将进行的内部写入 */
function mark(path: string): void {
    const key = normalize(path)
    // 如果已有计时器，先清掉
    const existing = pending.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => pending.delete(key), EXPIRY_MS)
    pending.set(key, timer)
}

/** 消费一次内部写入标记。返回 true 表示是内部写入，同时移除标记 */
function consume(path: string): boolean {
    const key = normalize(path)
    const timer = pending.get(key)
    if (timer) {
        clearTimeout(timer)
        pending.delete(key)
        return true
    }
    return false
}

export const internalWriteTracker = { mark, consume }
