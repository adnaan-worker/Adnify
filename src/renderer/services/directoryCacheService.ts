/**
 * 目录缓存服务
 * 缓存目录内容，减少重复的文件系统请求
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { CacheService } from '@shared/utils/CacheService'
import { getCacheConfig } from '@shared/config/agentConfig'
import { pathEquals, pathStartsWith, getDirname } from '@shared/utils/pathUtils'
import type { FileItem } from '@shared/types'

class DirectoryCacheService {
    private cache: CacheService<FileItem[]>
    private pendingRequests = new Map<string, Promise<FileItem[]>>()

    constructor() {
        const cacheConfig = getCacheConfig('directory')
        this.cache = new CacheService<FileItem[]>('DirectoryCache', {
            maxSize: cacheConfig.maxSize,
            defaultTTL: cacheConfig.ttlMs,
            cleanupInterval: 60000,
        })
    }

    /**
     * 获取目录内容（优先从缓存）
     */
    async getDirectory(path: string, forceRefresh = false): Promise<FileItem[]> {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.cache.get(path)
            if (cached) {
                return cached
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
            this.cache.set(path, items)
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
            const items = await api.file.readDir(path)
            return items
        } catch (error) {
            logger.file.error('[DirCache] Failed to read directory:', path, error)
            return []
        }
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
            if (pathEquals(key, path) || pathStartsWith(key, path)) {
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
        const parentPath = getDirname(eventPath)
        
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
     * 获取缓存统计信息
     */
    getStats() {
        return {
            ...this.cache.getStats(),
            pendingRequests: this.pendingRequests.size
        }
    }

    /**
     * 销毁服务
     */
    destroy() {
        this.cache.destroy()
        this.pendingRequests.clear()
    }
}

// 导出单例
export const directoryCacheService = new DirectoryCacheService()
