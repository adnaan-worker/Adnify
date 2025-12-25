import { useAgentStore } from './AgentStore'
import { OpenAIMessage } from './MessageConverter'
import { READ_ONLY_TOOLS } from '@/shared/constants'
import { logger } from '@/renderer/utils/Logger'

export class PlanManager {
    /**
     * 检查是否需要注入计划更新提醒
     * 如果在计划模式下，且本轮执行了写操作但未更新计划，则注入提醒
     */
    shouldInjectPlanReminder(llmMessages: OpenAIMessage[]): boolean {
        const store = useAgentStore.getState()
        if (!store.plan) return false

        const hasWriteOps = llmMessages.some(m =>
            m.role === 'assistant' &&
            m.tool_calls?.some((tc: any) => !READ_ONLY_TOOLS.includes(tc.function.name))
        )

        const hasUpdatePlan = llmMessages.some(m =>
            m.role === 'assistant' &&
            m.tool_calls?.some((tc: any) => tc.function.name === 'update_plan')
        )

        return hasWriteOps && !hasUpdatePlan
    }

    /**
     * 获取计划更新提醒消息
     */
    getPlanReminderMessage(): OpenAIMessage {
        return {
            role: 'user' as const,
            content: 'Reminder: You have performed some actions. Please use `update_plan` to update the plan status (e.g., mark the current step as completed) before finishing your response.',
        }
    }

    /**
     * 处理计划逻辑（在 Agent 循环中调用）
     * 如果需要提醒，则向消息历史中添加提醒并返回 true
     */
    processPlanLogic(llmMessages: OpenAIMessage[]): boolean {
        if (this.shouldInjectPlanReminder(llmMessages)) {
            logger.agent.info('Plan mode detected: Reminding AI to update plan status')
            llmMessages.push(this.getPlanReminderMessage())
            return true
        }
        return false
    }
}
