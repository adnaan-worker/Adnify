/**
 * 情绪感知模块
 * - constants: 颜色、meta、状态消息 key
 * - inflectionPoints: 拐点类型与计算
 * - panelSettings: 面板设置持久化
 * - 核心服务: 检测引擎、适配器、基线、上下文分析、反馈、动作
 */

export * from './constants'
export * from './inflectionPoints'
export * from './panelSettings'

// 核心服务
export { emotionAdapter } from './emotionAdapter'
export { emotionDetectionEngine } from './emotionDetectionEngine'
export { emotionBaseline } from './emotionBaseline'
export { emotionContextAnalyzer } from './emotionContextAnalyzer'
export { emotionFeedback } from './emotionFeedback'
export { getRecommendedActions } from './emotionActions'
export type { EmotionActionDef } from './emotionActions'
