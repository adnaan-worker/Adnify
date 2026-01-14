/**
 * 启动性能监控工具
 * 用于测量和记录应用启动各阶段的耗时
 */

import { logger } from './Logger'

interface StartupMetric {
  name: string
  startTime: number
  endTime?: number
  duration?: number
}

class StartupMetrics {
  private metrics: Map<string, StartupMetric> = new Map()
  private appStartTime: number = Date.now()

  /**
   * 标记一个阶段开始
   */
  start(name: string): void {
    this.metrics.set(name, {
      name,
      startTime: Date.now(),
    })
  }

  /**
   * 标记一个阶段结束
   */
  end(name: string): number {
    const metric = this.metrics.get(name)
    if (metric) {
      metric.endTime = Date.now()
      metric.duration = metric.endTime - metric.startTime
      return metric.duration
    }
    return 0
  }

  /**
   * 记录一个即时事件（相对于应用启动时间）
   */
  mark(name: string): number {
    const elapsed = Date.now() - this.appStartTime
    this.metrics.set(name, {
      name,
      startTime: this.appStartTime,
      endTime: Date.now(),
      duration: elapsed,
    })
    return elapsed
  }

  /**
   * 获取总启动时间
   */
  getTotalStartupTime(): number {
    return Date.now() - this.appStartTime
  }

  /**
   * 获取所有指标
   */
  getMetrics(): StartupMetric[] {
    return Array.from(this.metrics.values())
  }

  /**
   * 打印启动报告
   */
  printReport(): void {
    const totalTime = this.getTotalStartupTime()
    logger.perf.info('🚀 Startup Performance Report', { totalTime })
    
    const sortedMetrics = this.getMetrics().sort((a, b) => a.startTime - b.startTime)
    const metrics: Record<string, number> = {}
    for (const metric of sortedMetrics) {
      if (metric.duration !== undefined) {
        metrics[metric.name] = metric.duration
      }
    }
    
    logger.perf.info('Startup metrics:', metrics)
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.metrics.clear()
    this.appStartTime = Date.now()
  }
}

// 单例导出
export const startupMetrics = new StartupMetrics()
