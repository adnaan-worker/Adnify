/**
 * 个性化基线学习
 *
 * 持续跟踪用户的行为基线，用于校准情绪检测：
 *  - 基线打字速度（每个人不同）
 *  - 基线退格率
 *  - 活跃工作时段
 *  - 平均文件切换频率
 *
 * 数据持久化到 localStorage，跨会话学习。
 * 引擎用 getRelativeMetrics() 将绝对值转换为相对于个人基线的偏差。
 */

const STORAGE_KEY = 'adnify_emotion_baseline'
const LEARNING_SAMPLES = 50   // 至少 50 个样本后基线才生效
const MAX_SAMPLES = 500       // 最多保留 500 个样本

interface BaselineSample {
  timestamp: number
  typingSpeed: number       // WPM
  backspaceRate: number     // 0-1
  fileSwitchesPerMin: number
  hour: number              // 0-23
}

interface BaselineData {
  samples: BaselineSample[]
  // 缓存的统计值（避免每次重算）
  avgTypingSpeed: number
  avgBackspaceRate: number
  avgFileSwitchRate: number
  stdTypingSpeed: number
  preferredHours: number[]  // 最活跃的时段
}

class EmotionBaseline {
  private data: BaselineData

  constructor() {
    this.data = this.load()
  }

  /**
   * 记录一个行为样本
   */
  recordSample(typingSpeed: number, backspaceRate: number, fileSwitchesPerMin: number): void {
    // 忽略无效数据
    if (typingSpeed <= 0 && backspaceRate <= 0) return

    this.data.samples.push({
      timestamp: Date.now(),
      typingSpeed,
      backspaceRate,
      fileSwitchesPerMin,
      hour: new Date().getHours(),
    })

    // 限制大小
    if (this.data.samples.length > MAX_SAMPLES) {
      this.data.samples = this.data.samples.slice(-MAX_SAMPLES)
    }

    // 更新统计
    this.recalculate()
    this.save()
  }

  /**
   * 基线是否已经学习到足够数据
   */
  isCalibrated(): boolean {
    return this.data.samples.length >= LEARNING_SAMPLES
  }

  /**
   * 获取相对于基线的偏差指标
   *
   * 返回值含义：
   *  - typingSpeedDeviation: >0 比平时快, <0 比平时慢, 范围约 -3 到 +3（标准差）
   *  - backspaceRateDeviation: >0 比平时多退格
   *  - fileSwitchDeviation: >0 比平时多切换文件
   *  - isActiveHour: 当前是否在用户通常活跃的时段
   */
  getRelativeMetrics(
    currentTypingSpeed: number,
    currentBackspaceRate: number,
    currentFileSwitchRate: number,
  ): {
    typingSpeedDeviation: number
    backspaceRateDeviation: number
    fileSwitchDeviation: number
    isActiveHour: boolean
    calibrated: boolean
  } {
    if (!this.isCalibrated()) {
      return {
        typingSpeedDeviation: 0,
        backspaceRateDeviation: 0,
        fileSwitchDeviation: 0,
        isActiveHour: true,
        calibrated: false,
      }
    }

    const typingDev = this.data.stdTypingSpeed > 0
      ? (currentTypingSpeed - this.data.avgTypingSpeed) / this.data.stdTypingSpeed
      : 0

    const bsDev = this.data.avgBackspaceRate > 0
      ? (currentBackspaceRate - this.data.avgBackspaceRate) / Math.max(this.data.avgBackspaceRate, 0.01)
      : 0

    const fsDev = this.data.avgFileSwitchRate > 0
      ? (currentFileSwitchRate - this.data.avgFileSwitchRate) / Math.max(this.data.avgFileSwitchRate, 0.1)
      : 0

    const hour = new Date().getHours()
    const isActiveHour = this.data.preferredHours.includes(hour)

    return {
      typingSpeedDeviation: clamp(typingDev, -3, 3),
      backspaceRateDeviation: clamp(bsDev, -3, 3),
      fileSwitchDeviation: clamp(fsDev, -3, 3),
      isActiveHour,
      calibrated: true,
    }
  }

  /**
   * 获取基线统计（用于 UI 展示）
   */
  getStats(): {
    sampleCount: number
    avgTypingSpeed: number
    avgBackspaceRate: number
    preferredHours: number[]
    calibrated: boolean
  } {
    return {
      sampleCount: this.data.samples.length,
      avgTypingSpeed: this.data.avgTypingSpeed,
      avgBackspaceRate: this.data.avgBackspaceRate,
      preferredHours: this.data.preferredHours,
      calibrated: this.isCalibrated(),
    }
  }

  // ===== 内部计算 =====

  private recalculate(): void {
    const samples = this.data.samples
    if (samples.length === 0) return

    // 平均打字速度
    const speeds = samples.map(s => s.typingSpeed).filter(s => s > 0)
    this.data.avgTypingSpeed = speeds.length > 0
      ? speeds.reduce((a, b) => a + b, 0) / speeds.length
      : 0

    // 标准差
    if (speeds.length > 1) {
      const variance = speeds.reduce((sum, s) => sum + Math.pow(s - this.data.avgTypingSpeed, 2), 0) / speeds.length
      this.data.stdTypingSpeed = Math.sqrt(variance)
    } else {
      this.data.stdTypingSpeed = 10 // 默认标准差
    }

    // 平均退格率（过滤非法值）
    const bsRates = samples.map(s => s.backspaceRate).filter(v => Number.isFinite(v))
    this.data.avgBackspaceRate = bsRates.length > 0
      ? bsRates.reduce((a, b) => a + b, 0) / bsRates.length
      : 0

    // 平均文件切换率（过滤非法值）
    const fsRates = samples.map(s => s.fileSwitchesPerMin).filter(v => Number.isFinite(v))
    this.data.avgFileSwitchRate = fsRates.length > 0
      ? fsRates.reduce((a, b) => a + b, 0) / fsRates.length
      : 0

    // 活跃时段：统计每个小时的样本数，取前 8 个
    const hourCounts = new Array(24).fill(0)
    for (const s of samples) hourCounts[s.hour]++
    this.data.preferredHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(h => h.hour)
      .sort((a, b) => a - b)
  }

  // ===== 持久化 =====

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
    } catch {
      // ignore
    }
  }

  private load(): BaselineData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as BaselineData
        if (data.samples && Array.isArray(data.samples)) return data
      }
    } catch {
      // ignore
    }
    return {
      samples: [],
      avgTypingSpeed: 0,
      avgBackspaceRate: 0,
      avgFileSwitchRate: 0,
      stdTypingSpeed: 10,
      preferredHours: [],
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export const emotionBaseline = new EmotionBaseline()
