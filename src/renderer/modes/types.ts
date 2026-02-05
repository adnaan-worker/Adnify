/**
 * 工作模式类型定义
 */

// 从 shared 导入共享类型
export type { WorkMode } from '@shared/types/workMode'
import type { WorkMode } from '@shared/types/workMode'

/** 模式配置 */
export interface ModeConfig {
    id: WorkMode
    label: string
    icon: string
    description: string
}

/** 所有模式配置 */
export const MODE_CONFIGS: Record<WorkMode, ModeConfig> = {
    chat: {
        id: 'chat',
        label: 'Chat',
        icon: 'MessageSquare',
        description: '快速问答，无工具调用'
    },
    agent: {
        id: 'agent',
        label: 'Agent',
        icon: 'Sparkles',
        description: '单次任务，工具调用'
    },
    orchestrator: {
        id: 'orchestrator',
        label: 'Orchestrator',
        icon: 'Workflow',
        description: '多轮交互，任务编排'
    }
}
