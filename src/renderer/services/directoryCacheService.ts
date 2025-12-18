/**
 * 目录缓存服务
 * 缓存目录内容，减少重复的文件系统请求
 */

import { FileItem } from '../types/electron'

interface CacheEntry {
    items: FileItem[]
    timestamp: number
}

class DirectoryCacheService {
    private cache = new Map<string, CacheEntry>()
    private pendingRequests = new Map<string, Promise<FileItem[]>>()
    
    // 缓存过期时间（5分钟）
    private readonly TTL = 5 * 60 * 1000
    // 最大缓存条目数
    private readonly MAX_ENTRIES = 200

    /**
     * 获取目录内容（优先从缓存）
     */
    async getDirectory(path: string, forceRefresh = false): Promise<FileItem[]> {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.cache.get(path)
            if (cached && Date.now() - cached.timestamp < this.TTL) {
                return cached.items
            }
        }

        // 检查是否有正在进行的请求（避免重复请求）
        const pending = this.pendingRequests.get(path)
        if (pending) {
            return pending
        }

        // 发起新请求
        const request = this.fetchDirectory(path)
        this.pendingRequests.set(path, request)

        try {
            const items = await request
            this.setCache(path, items)
            return items
        } finally {
            this.pendingRequests.delete(path)
        }
    }

    /**
     * 实际获取目录内容
     */
    private async fetchDirectory(path: string): Promise<FileItem[]> {
        try {
            const items = await window.electronAPI.readDir(path)
            return items
        } catch (error) {
            console.error('[DirCache] Failed to read directory:', path, error)
            return []
        }
    }

    /**
     * 设置缓存
     */
    private setCache(path: string, items: FileItem[]) {
        // 如果缓存已满，删除最旧的条目
        if (this.cache.size >= this.MAX_ENTRIES) {
            const oldestKey = this.findOldestEntry()
            if (oldestKey) {
                this.cache.delete(oldestKey)
            }
        }

        this.cache.set(path, {
            items,
            timestamp: Date.now()
        })
    }

    /**
     * 找到最旧的缓存条目
     */
    private findOldestEntry(): string | null {
        let oldestKey: string | null = null
        let oldestTime = Infinity

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp
                oldestKey = key
            }
        }

        return oldestKey
    }

    /**
     * 使指定路径的缓存失效
     */
    invalidate(path: string) {
        this.cache.delete(path)
    }

    /**
     * 使指定路径及其所有子目录的缓存失效
     */
    invalidateTree(path: string) {
        const keysToDelete: string[] = []
        
        for (const key of this.cache.keys()) {
            if (key === path || key.startsWith(path + '/') || key.startsWith(path + '\\')) {
                keysToDelete.push(key)
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key))
    }

    /**
     * 根据文件变化事件智能失效缓存
     */
    handleFileChange(eventPath: string, eventType: 'create' | 'update' | 'delete') {
        // 获取父目录路径
        const parentPath = this.getParentPath(eventPath)
        
        if (eventType === 'create' || eventType === 'delete') {
            // 创建或删除文件时，需要刷新父目录
            if (parentPath) {
                this.invalidate(parentPath)
            }
        }

        // 如果是目录被删除，清除该目录及子目录的缓存
        if (eventType === 'delete') {
            this.invalidateTree(eventPath)
        }
    }

    /**
     * 获取父目录路径
     */
    private getParentPath(filePath: string): string | null {
        const separatorIndex = Math.max(
            filePath.lastIndexOf('/'),
            filePath.lastIndexOf('\\')
        )
        
        if (separatorIndex > 0) {
            return filePath.substring(0, separatorIndex)
        }
        
        return null
    }

    /**
     * 预加载目录（用于展开文件夹时预加载子目录）
     */
    async preload(paths: string[]) {
        const uncached = paths.filter(p => !this.cache.has(p))
        
        // 并行加载，但限制并发数
        const batchSize = 5
        for (let i = 0; i < uncached.length; i += batchSize) {
            const batch = uncached.slice(i, i + batchSize)
            await Promise.all(batch.map(p => this.getDirectory(p)))
        }
    }

    /**
     * 清空所有缓存
     */
    clear() {
        this.cache.clear()
        this.pendingRequests.clear()
    }

    /**
     * 获取缓存统计信息（调试用）
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.MAX_ENTRIES,
            pendingRequests: this.pendingRequests.size
        }
    }
}

// 导出单例
export const directoryCacheService = new DirectoryCacheService()
