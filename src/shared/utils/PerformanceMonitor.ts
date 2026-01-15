/**
 * 性能监控服务
 * 统计 LLM 调用、工具执行、文件操作等性能指标
 * 
 * 优化点：
 * 1. 添加内存使用监控
 * 2. 统一清理 metrics 和 history
 * 3. 添加采样机制减少高频操作的记录开销
 * 4. 支持导出和持久化
 */

import { logger } from './Logger'

// 性能指标类型
export interface PerformanceMetric {
  name: string
  category: MetricCategory
  count: number
  totalDuration: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  lastDuration: number
  lastTimestamp: number
  errors: number
  // 新增：P95/P99 百分位数（基于最近记录）
  p95Duration?: number
  p99Duration?: number
}

export type MetricCategory = 'llm' | 'tool' | 'file' | 'index' | 'network' | 'render'

// 单次测量记录
interface MeasurementRecord {
  duration: number
  timestamp: number
  success: boolean
  metadata?: Record<string, unknown>
}

// 内存使用快照
export interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
  rss?: number
}

// 性能监控配置
interface PerformanceConfig {
  enabled: boolean
  maxHistoryPerMetric: number
  maxMetrics: number
  slowThresholds: Record<MetricCategory, number>
  reportInterval: number
  // 新增配置
  samplingRate: Record<MetricCategory, number> // 采样率 0-1，1 表示全部记录
  memorySnapshotInterval: number // 内存快照间隔（毫秒）
  maxMemorySnapshots: number // 最大内存快照数量
  enablePercentiles: boolean // 是否计算百分位数
}

class PerformanceMonitorClass {
  private config: PerformanceConfig = {
    enabled: true,
    maxHistoryPerMetric: 100,
    maxMetrics: 500,
    slowThresholds: {
      llm: 5000,
      tool: 3000,
      file: 1000,
      index: 10000,
      network: 5000,
      render: 100,
    },
    reportInterval: 60000,
    // 新增默认配置
    samplingRate: {
      llm: 1,      // LLM 调用全部记录
      tool: 1,     // 工具调用全部记录
      file: 0.5,   // 文件操作 50% 采样
      index: 1,    // 索引操作全部记录
      network: 1,  // 网络请求全部记录
      render: 0.1, // 渲染操作 10% 采样（高频）
    },
    memorySnapshotInterval: 30000, // 30 秒一次内存快照
    maxMemorySnapshots: 60,        // 保留最近 30 分钟的快照
    enablePercentiles: true,
  }

  private metrics: Map<string, PerformanceMetric> = new Map()
  private history: Map<string, MeasurementRecord[]> = new Map()
  private activeTimers: Map<string, { startTime: number; category: MetricCategory; metadata?: Record<string, unknown> }> = new Map()
  private reportTimer: NodeJS.Timeout | null = null
  
  // 新增：内存监控
  private memorySnapshots: MemorySnapshot[] = []
  private memoryTimer: NodeJS.Timeout | null = null
  
  // 新增：采样计数器（用于确定性采样）
  private sampleCounters: Map<MetricCategory, number> = new Map()

  constructor() {
    this.startPeriodicReport()
    this.startMemoryMonitoring()
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitoring(): void {
    if (this.memoryTimer) return
    
    // 立即记录一次
    this.recordMemorySnapshot()
    
    this.memoryTimer = setInterval(() => {
      this.recordMemorySnapshot()
    }, this.config.memorySnapshotInterval)
  }

  /**
   * 记录内存快照
   */
  private recordMemorySnapshot(): void {
    if (!this.config.enabled) return
    
    try {
      // 浏览器环境使用 performance.memory（仅 Chrome）
      // Node.js 环境使用 process.memoryUsage()
      let snapshot: MemorySnapshot
      
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const mem = process.memoryUsage()
        snapshot = {
          timestamp: Date.now(),
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          rss: mem.rss,
        }
      } else if (typeof performance !== 'undefined' && 'memory' in performance) {
        // Chrome 特有的 performance.memory API
        const perfWithMemory = performance as Performance & {
          memory?: {
            usedJSHeapSize: number
            totalJSHeapSize: number
            jsHeapSizeLimit: number
          }
        }
        const mem = perfWithMemory.memory
        if (mem) {
          snapshot = {
            timestamp: Date.now(),
            heapUsed: mem.usedJSHeapSize,
            heapTotal: mem.totalJSHeapSize,
            external: 0,
          }
        } else {
          return // 不支持内存监控
        }
      } else {
        return // 不支持内存监控
      }
      
      this.memorySnapshots.push(snapshot)
      
      // 限制快照数量
      while (this.memorySnapshots.length > this.config.maxMemorySnapshots) {
        this.memorySnapshots.shift()
      }
      
      // 检测内存泄漏趋势
      this.detectMemoryLeak()
    } catch {
      // 忽略内存监控错误
    }
  }

  /**
   * 检测内存泄漏趋势
   */
  private detectMemoryLeak(): void {
    if (this.memorySnapshots.length < 10) return
    
    const recent = this.memorySnapshots.slice(-10)
    const first = recent[0]
    const last = recent[recent.length - 1]
    
    // 如果最近 10 次快照内存持续增长超过 50%，发出警告
    const growthRate = (last.heapUsed - first.heapUsed) / first.heapUsed
    if (growthRate > 0.5) {
      logger.perf.warn('Potential memory leak detected', {
        growthRate: `${(growthRate * 100).toFixed(1)}%`,
        heapUsed: `${(last.heapUsed / 1024 / 1024).toFixed(1)}MB`,
        duration: `${((last.timestamp - first.timestamp) / 1000).toFixed(0)}s`,
      })
    }
  }

  /**
   * 获取内存快照
   */
  getMemorySnapshots(): MemorySnapshot[] {
    return [...this.memorySnapshots]
  }

  /**
   * 获取当前内存使用
   */
  getCurrentMemory(): MemorySnapshot | null {
    return this.memorySnapshots[this.memorySnapshots.length - 1] || null
  }

  /**
   * 判断是否应该采样记录
   */
  private shouldSample(category: MetricCategory): boolean {
    const rate = this.config.samplingRate[category]
    if (rate >= 1) return true
    if (rate <= 0) return false
    
    // 使用确定性采样，确保均匀分布
    const counter = (this.sampleCounters.get(category) || 0) + 1
    this.sampleCounters.set(category, counter)
    
    const interval = Math.round(1 / rate)
    return counter % interval === 0
  }

  /**
   * 配置性能监控
   */
  configure(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 启用/禁用监控
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  /**
   * 开始计时
   */
  start(name: string, category: MetricCategory, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) return

    this.activeTimers.set(name, {
      startTime: performance.now(),
      category,
      metadata,
    })
  }

  /**
   * 结束计时并记录
   */
  end(name: string, success: boolean = true, additionalMetadata?: Record<string, unknown>): number | null {
    if (!this.config.enabled) return null

    const timer = this.activeTimers.get(name)
    if (!timer) {
      logger.perf.warn(`Timer "${name}" not found`)
      return null
    }

    const duration = Math.round(performance.now() - timer.startTime)
    this.activeTimers.delete(name)

    this.record(name, timer.category, duration, success, { ...timer.metadata, ...additionalMetadata })

    return duration
  }

  /**
   * 记录一次测量
   */
  record(
    name: string,
    category: MetricCategory,
    duration: number,
    success: boolean = true,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.config.enabled) return

    const key = `${category}:${name}`
    const now = Date.now()

    // 更新指标（始终更新，不受采样影响）
    let metric = this.metrics.get(key)
    if (!metric) {
      if (this.metrics.size >= this.config.maxMetrics) {
        this.evictOldestMetric()
      }
      
      metric = {
        name,
        category,
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        lastDuration: 0,
        lastTimestamp: 0,
        errors: 0,
      }
      this.metrics.set(key, metric)
    }

    metric.count++
    metric.totalDuration += duration
    metric.avgDuration = Math.round(metric.totalDuration / metric.count)
    metric.minDuration = Math.min(metric.minDuration, duration)
    metric.maxDuration = Math.max(metric.maxDuration, duration)
    metric.lastDuration = duration
    metric.lastTimestamp = now
    if (!success) metric.errors++

    // 记录历史（受采样率影响）
    if (this.shouldSample(category)) {
      let hist = this.history.get(key)
      if (!hist) {
        hist = []
        this.history.set(key, hist)
      }
      hist.push({ duration, timestamp: now, success, metadata })
      if (hist.length > this.config.maxHistoryPerMetric) {
        hist.shift()
      }
      
      // 计算百分位数
      if (this.config.enablePercentiles && hist.length >= 10) {
        this.updatePercentiles(metric, hist)
      }
    }

    // 检查是否为慢操作
    const threshold = this.config.slowThresholds[category]
    if (duration > threshold) {
      logger.perf.warn(`Slow ${category} operation: ${name}`, {
        duration,
        threshold,
        metadata,
      })
    }
  }

  /**
   * 更新百分位数
   */
  private updatePercentiles(metric: PerformanceMetric, history: MeasurementRecord[]): void {
    const durations = history.map(h => h.duration).sort((a, b) => a - b)
    const len = durations.length
    
    metric.p95Duration = durations[Math.floor(len * 0.95)]
    metric.p99Duration = durations[Math.floor(len * 0.99)]
  }

  /**
   * 测量异步函数
   */
  async measure<T>(
    name: string,
    category: MetricCategory,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    this.start(name, category, metadata)
    try {
      const result = await fn()
      this.end(name, true)
      return result
    } catch (error) {
      this.end(name, false, { error: String(error) })
      throw error
    }
  }

  /**
   * 测量同步函数
   */
  measureSync<T>(
    name: string,
    category: MetricCategory,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    this.start(name, category, metadata)
    try {
      const result = fn()
      this.end(name, true)
      return result
    } catch (error) {
      this.end(name, false, { error: String(error) })
      throw error
    }
  }

  /**
   * 获取指标
   */
  getMetric(name: string, category: MetricCategory): PerformanceMetric | undefined {
    return this.metrics.get(`${category}:${name}`)
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values())
  }

  /**
   * 获取分类指标
   */
  getMetricsByCategory(category: MetricCategory): PerformanceMetric[] {
    return this.getAllMetrics().filter(m => m.category === category)
  }

  /**
   * 获取历史记录
   */
  getHistory(name: string, category: MetricCategory): MeasurementRecord[] {
    return this.history.get(`${category}:${name}`) || []
  }

  /**
   * 获取性能摘要
   */
  getSummary(): {
    totalOperations: number
    totalErrors: number
    avgDuration: number
    byCategory: Record<MetricCategory, { count: number; avgDuration: number; errors: number }>
  } {
    const metrics = this.getAllMetrics()
    const byCategory: Record<MetricCategory, { count: number; avgDuration: number; errors: number; totalDuration: number }> = {
      llm: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
      tool: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
      file: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
      index: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
      network: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
      render: { count: 0, avgDuration: 0, errors: 0, totalDuration: 0 },
    }

    let totalOperations = 0
    let totalErrors = 0
    let totalDuration = 0

    for (const metric of metrics) {
      totalOperations += metric.count
      totalErrors += metric.errors
      totalDuration += metric.totalDuration

      const cat = byCategory[metric.category]
      cat.count += metric.count
      cat.errors += metric.errors
      cat.totalDuration += metric.totalDuration
    }

    // 计算平均值
    for (const cat of Object.values(byCategory)) {
      cat.avgDuration = cat.count > 0 ? Math.round(cat.totalDuration / cat.count) : 0
    }

    return {
      totalOperations,
      totalErrors,
      avgDuration: totalOperations > 0 ? Math.round(totalDuration / totalOperations) : 0,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, { count: v.count, avgDuration: v.avgDuration, errors: v.errors }])
      ) as Record<MetricCategory, { count: number; avgDuration: number; errors: number }>,
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics.clear()
    this.history.clear()
    this.activeTimers.clear()
    this.memorySnapshots.length = 0
    this.sampleCounters.clear()
  }

  /**
   * 导出性能数据（用于持久化或分析）
   */
  export(): {
    metrics: PerformanceMetric[]
    memory: MemorySnapshot[]
    summary: ReturnType<PerformanceMonitorClass['getSummary']>
    exportedAt: number
  } {
    return {
      metrics: this.getAllMetrics(),
      memory: this.getMemorySnapshots(),
      summary: this.getSummary(),
      exportedAt: Date.now(),
    }
  }

  /**
   * 获取内存使用摘要
   */
  getMemorySummary(): {
    current: MemorySnapshot | null
    peak: MemorySnapshot | null
    average: number
    trend: 'stable' | 'increasing' | 'decreasing'
  } {
    if (this.memorySnapshots.length === 0) {
      return { current: null, peak: null, average: 0, trend: 'stable' }
    }

    const current = this.memorySnapshots[this.memorySnapshots.length - 1]
    let peak = this.memorySnapshots[0]
    let total = 0

    for (const snapshot of this.memorySnapshots) {
      total += snapshot.heapUsed
      if (snapshot.heapUsed > peak.heapUsed) {
        peak = snapshot
      }
    }

    const average = total / this.memorySnapshots.length

    // 计算趋势
    let trend: 'stable' | 'increasing' | 'decreasing' = 'stable'
    if (this.memorySnapshots.length >= 5) {
      const recent = this.memorySnapshots.slice(-5)
      const firstHalf = recent.slice(0, 2).reduce((a, b) => a + b.heapUsed, 0) / 2
      const secondHalf = recent.slice(-2).reduce((a, b) => a + b.heapUsed, 0) / 2
      const change = (secondHalf - firstHalf) / firstHalf

      if (change > 0.1) trend = 'increasing'
      else if (change < -0.1) trend = 'decreasing'
    }

    return { current, peak, average, trend }
  }

  /**
   * 淘汰最旧的指标（LRU）
   * 同时清理 metrics 和 history，防止内存泄漏
   */
  private evictOldestMetric(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, metric] of this.metrics) {
      if (metric.lastTimestamp < oldestTime) {
        oldestTime = metric.lastTimestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.metrics.delete(oldestKey)
      this.history.delete(oldestKey) // 确保同时清理 history
      logger.perf.debug(`Evicted old metric: ${oldestKey}`)
    }
  }

  /**
   * 批量清理过期数据
   * 清理超过指定时间未更新的指标
   */
  pruneStaleMetrics(maxAgeMs: number = 3600000): number {
    const now = Date.now()
    const cutoff = now - maxAgeMs
    let pruned = 0

    for (const [key, metric] of this.metrics) {
      if (metric.lastTimestamp < cutoff) {
        this.metrics.delete(key)
        this.history.delete(key)
        pruned++
      }
    }

    if (pruned > 0) {
      logger.perf.info(`Pruned ${pruned} stale metrics`)
    }

    return pruned
  }

  /**
   * 启动定期报告
   */
  private startPeriodicReport(): void {
    if (this.reportTimer) return

    this.reportTimer = setInterval(() => {
      if (!this.config.enabled) return

      const summary = this.getSummary()
      if (summary.totalOperations > 0) {
        logger.perf.info('Performance summary', summary)
      }
    }, this.config.reportInterval)
  }

  /**
   * 停止定期报告
   */
  stopPeriodicReport(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer)
      this.reportTimer = null
    }
  }

  /**
   * 停止内存监控
   */
  stopMemoryMonitoring(): void {
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer)
      this.memoryTimer = null
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopPeriodicReport()
    this.stopMemoryMonitoring()
    this.clear()
  }
}

// 单例导出
export const performanceMonitor = new PerformanceMonitorClass()

export default performanceMonitor
