/**
 * 情绪感知环境类型定义
 */

/** 检测到的开发者情绪状态 */
export type EmotionState = 
  | 'focused'      // 专注 - 高效编码中
  | 'frustrated'   // 沮丧 - 连续报错/卡住
  | 'tired'        // 疲劳 - 长时间工作
  | 'excited'      // 兴奋 - 快速编码/新想法
  | 'bored'        // 无聊 - 重复性工作
  | 'stressed'     // 压力 - 紧急任务/多线程工作
  | 'flow'         // 心流 - 深度沉浸状态
  | 'neutral'      // 中性 - 正常工作

/** 情绪强度 0-1 */
export type EmotionIntensity = number

/** 情绪检测结果 */
export interface EmotionDetection {
  state: EmotionState
  intensity: EmotionIntensity
  confidence: number  // AI 对检测结果的置信度
  triggeredAt: number
  duration: number    // 该状态持续时长(ms)
  factors: EmotionFactor[]
  context?: CodeContext  // 检测时的代码上下文
  suggestions?: string[]  // 基于当前状态的建议
  similarPatterns?: {  // 相似的历史模式
    timestamp: number
    state: EmotionState
    outcome: 'positive' | 'negative' | 'neutral'
  }[]
}

/** 影响情绪的因素 */
export interface EmotionFactor {
  type: EmotionFactorType
  weight: number      // 对当前情绪的影响权重
  value: number       // 具体数值
  description: string
}

export type EmotionFactorType =
  | 'typing_speed'       // 打字速度变化
  | 'error_rate'         // 错误率
  | 'pause_duration'     // 停顿时间
  | 'code_complexity'    // 当前代码复杂度
  | 'time_of_day'        // 时间段
  | 'session_duration'   // 连续工作时长
  | 'tab_switching'      // 标签切换频率
  | 'undo_redo_rate'     // 撤销/重做频率
  | 'test_failure_rate'  // 测试失败率
  | 'save_frequency'     // 保存频率
  | 'ai_interaction_pattern'  // AI交互模式（频繁提问=困惑，快速接受=流畅）
  | 'code_change_pattern'     // 代码变更模式（大重构=压力，小优化=专注）
  | 'git_activity'            // Git活动（频繁提交=兴奋，无提交=卡住）
  | 'error_context'           // 错误上下文（语法错误=沮丧，逻辑错误=思考）
  | 'file_type_pattern'        // 文件类型模式（测试文件=自信，配置文件=谨慎）
  | 'search_pattern'           // 搜索模式（频繁搜索=困惑，少搜索=熟悉）

/** 环境适配配置 */
export interface EnvironmentAdaptation {
  theme: {
    id: string
    brightness: 'dim' | 'normal' | 'bright'
    accentColor: string
  }
  ui: {
    notifications: 'minimal' | 'normal' | 'disabled'
    animationSpeed: 'slow' | 'normal' | 'fast'
    fontSize: number
    lineHeight: number
  }
  ai: {
    proactivity: 'passive' | 'suggestive' | 'active'
    tone: 'encouraging' | 'neutral' | 'direct'
    suggestionFrequency: 'low' | 'medium' | 'high'
  }
  sound: {
    enabled: boolean
    volume: number
    type?: 'focus' | 'relax' | 'energize' | 'none'
  }
  break: {
    suggestBreak: boolean
    breakInterval: number  // 建议休息间隔(ms)
    microBreaks: boolean   // 微休息（20秒眼部放松）
  }
}

/** 情绪历史记录 */
export interface EmotionHistory {
  timestamp: number
  state: EmotionState
  intensity: number
  project: string
  file: string
}

/** 情绪感知配置 */
export interface EmotionAwareConfig {
  enabled: boolean
  sensitivity: 'low' | 'medium' | 'high'
  autoAdapt: boolean
  privacyMode: boolean  // 是否本地处理，不上传数据
  workHours: {
    start: number  // 0-23
    end: number
  }
  adaptations: Record<EmotionState, EnvironmentAdaptation>
  customTriggers: CustomTrigger[]
}

/** 自定义触发器 */
export interface CustomTrigger {
  id: string
  name: string
  condition: TriggerCondition
  action: TriggerAction
  enabled: boolean
}

export interface TriggerCondition {
  type: EmotionFactorType | 'emotion_state'
  operator: '>' | '<' | '==' | '!=' | '>=' | '<='
  value: number | string
  duration?: number  // 持续时间(ms)
}

export interface TriggerAction {
  type: 'notification' | 'theme_change' | 'sound' | 'break_suggestion' | 'ai_message'
  payload: unknown
}

/** 上下文信息 */
export interface CodeContext {
  currentFile: string
  fileType: string           // 'ts', 'tsx', 'js', 'test', 'config', etc.
  projectType: string        // 'react', 'node', 'python', etc.
  recentFiles: string[]      // 最近打开的文件
  codeComplexity: number     // 代码复杂度评分
  hasErrors: boolean         // 当前是否有错误
  errorType?: 'syntax' | 'type' | 'runtime' | 'test'
  gitStatus?: 'clean' | 'modified' | 'conflict'
  recentCommits: number      // 最近1小时的提交数
  searchQueries: number       // 最近搜索次数
  aiInteractions: {
    count: number            // AI交互次数
    avgResponseTime: number  // 平均响应时间
    rejectionRate: number    // 拒绝AI建议的比例
    questionComplexity: 'simple' | 'medium' | 'complex'
  }
}

/** 实时行为指标 */
export interface BehaviorMetrics {
  timestamp: number
  typingSpeed: number        // WPM (words per minute)
  errorRate: number          // 0-1
  activeTypingTime: number   // 连续打字时长(ms)
  pauseDuration: number      // 当前停顿时长(ms)
  keystrokes: number         // 按键次数
  backspaceRate: number      // 退格率
  cursorMovement: number     // 光标移动次数
  copyPasteCount: number     // 复制粘贴次数
  fileSwitches: number       // 文件切换次数
  testRuns: number           // 测试运行次数
  testFailures: number       // 测试失败次数
  context?: CodeContext       // 代码上下文（可选，需要时获取）
}

/** 用户反馈 */
export interface UserFeedback {
  timestamp: number
  detectedState: EmotionState
  userState: EmotionState | null  // null表示用户未反馈
  accuracy: 'correct' | 'incorrect' | 'partial'
  notes?: string
}

/** 个性化模式 */
export interface PersonalPattern {
  userId: string
  baselineTypingSpeed: number      // 个人基准打字速度
  preferredWorkHours: number[]      // 偏好的工作时间段
  emotionTransitions: Record<EmotionState, Record<EmotionState, number>>  // 情绪转换概率
  factorWeights: Record<EmotionFactorType, number>  // 个人化的因子权重
  adaptationPreferences: Partial<EnvironmentAdaptation>  // 个人适配偏好
  learnedTriggers: CustomTrigger[]  // 学习到的触发器
}
