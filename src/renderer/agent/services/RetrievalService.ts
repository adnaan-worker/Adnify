import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '../store/AgentStore'
import { z } from 'zod'
import { getLLMConfigForTask } from './llmConfigService'

export interface RetrievalResult {
    relativePath: string
    score: number
    content: string
    startLine: number
    endLine: number
    language: string
}

interface OptimizedQuery {
    keywords: string[]
    semanticQuery: string
}

const querySchema = z.object({
    keywords: z.array(z.string()).describe('1-3 most important technical terms or partial file paths'),
    semanticQuery: z.string().describe('A clean, technical version of the request for semantic search')
})

class RetrievalService {
    /**
     * 使用 LLM 优化查询词，提取核心意图
     * 模仿 codebase 工具的行为，从提问和历史记录中提取搜索参数
     */
    private async optimizeQueryWithLLM(query: string, history?: string): Promise<OptimizedQuery> {
        const prompt = `You are an expert at extracting code search parameters from user conversations.
Given the current user query and recent history, identify the specific technical concepts, file names, or features the user is asking about.

User Query: "${query}"
${history ? `Recent History Summary: "${history}"` : ''}

Rules:
- Remove conversational filler (e.g., "please show me", "how does", "look at").
- If Chinese, extract precise technical terms.
- Focus on nouns and specific actions (e.g., "auth logic", "login validation").`

        try {
            // 获取默认模型配置
            const store = useStore.getState()
            const config = await getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)

            if (!config) throw new Error('No LLM config available')

            const res = await api.llm.generateObject({
                config,
                schema: querySchema,
                prompt,
                system: "You categorize and extract technical search terms from user queries. Strictly output JSON matching the schema."
            })

            if (res && typeof res === 'object') {
                const obj = res as any
                return {
                    keywords: Array.isArray(obj.keywords) ? obj.keywords : [query],
                    semanticQuery: obj.semanticQuery || query
                }
            }
        } catch (err) {
            logger.agent.warn('[RetrievalService] LLM query optimization failed, falling back to basic extraction:', err)
        }

        // 回退方案：如果 LLM 失败，则使用简单的分词处理
        const basicKeywords = query.split(/[\s,.:;!?()[\]{}'"]+/).filter(t => t.length > 1).slice(0, 3)
        return {
            keywords: basicKeywords.length > 0 ? basicKeywords : [query],
            semanticQuery: query
        }
    }

    /**
     * 执行检索并处理 UI 状态
     */
    async retrieve(params: {
        query: string
        history?: string
        workspacePath: string
        assistantId?: string
        threadId?: string
        threshold?: number
        limit?: number
    }): Promise<RetrievalResult[]> {
        const {
            query,
            history,
            workspacePath,
            assistantId,
            threadId,
            threshold = 0.3,
            limit = 3
        } = params

        const language = useStore.getState().language || 'en'

        let searchPartId: string | undefined

        // 1. 初始化 UI 搜索块 (显示初始状态)
        if (assistantId && threadId) {
            const threadBoundStore = useAgentStore.getState().forThread(threadId)
            searchPartId = threadBoundStore.addSearchPart(assistantId)

            const initText = language === 'zh' ? '正在分析搜索意图...' : 'Analyzing search intent...'
            threadBoundStore.updateSearchPart(assistantId, searchPartId, initText, true)

            // 让出线程，确保 "分析意图" 的状态块能立刻在 UI 展现
            await new Promise(resolve => setTimeout(resolve, 0))
        }

        try {
            const startTime = Date.now()

            // 2. 使用 LLM 进行查询提炼
            const optimized = await this.optimizeQueryWithLLM(query, history)

            // 更新 UI，告知用户系统实际上在搜什么
            if (assistantId && threadId && searchPartId) {
                const queryDisplay = optimized.keywords.join(', ') || optimized.semanticQuery
                const searchingText = language === 'zh'
                    ? `正在根据关键词 "${queryDisplay}" 检索代码...`
                    : `Retrieving code for "${queryDisplay}"...`
                useAgentStore.getState().forThread(threadId).updateSearchPart(assistantId, searchPartId, searchingText, true)
            }

            // 3. 执行混合搜索
            // 注意：我们结合了优化后的关键词和语义查询
            const searchQuery = optimized.semanticQuery
            const allResults = await api.index.hybridSearch(workspacePath, searchQuery, 10) as RetrievalResult[]

            // 4. 确保状态展示至少 500ms，避免闪烁
            const elapsed = Date.now() - startTime
            if (elapsed < 600) {
                await new Promise(resolve => setTimeout(resolve, 600 - elapsed))
            }

            if (!allResults || allResults.length === 0) {
                this.finalizeUI(threadId, assistantId, searchPartId, language, 'no_results')
                return []
            }

            // 5. 过滤和限制
            const relevantResults = allResults.filter(r => r.score >= threshold)

            if (relevantResults.length === 0) {
                const bestScore = allResults[0].score.toFixed(3)
                this.finalizeUI(threadId, assistantId, searchPartId, language, 'low_score', { bestScore, threshold })
                return []
            }

            const finalResults = relevantResults.slice(0, limit)

            // 6. 更新 UI 显示找到的文件
            this.finalizeUI(threadId, assistantId, searchPartId, language, 'success', { count: finalResults.length, results: finalResults })

            return finalResults
        } catch (err) {
            logger.agent.error('[RetrievalService] Search failed:', err)
            this.finalizeUI(threadId, assistantId, searchPartId, language, 'error')
            return []
        }
    }

    private finalizeUI(
        threadId: string | undefined,
        assistantId: string | undefined,
        searchPartId: string | undefined,
        language: string,
        type: 'success' | 'no_results' | 'low_score' | 'error',
        data?: any
    ) {
        if (!threadId || !assistantId || !searchPartId) return

        const store = useAgentStore.getState().forThread(threadId)
        let message = ''

        switch (type) {
            case 'success':
                const foundHeader = language === 'zh' ? `已找到 ${data.count} 个相关文件：\n` : `Found ${data.count} relevant files:\n`
                const filesList = data.results.map((r: any) => `- ${r.relativePath}`).join('\n')
                message = foundHeader + filesList
                break
            case 'no_results':
                message = language === 'zh' ? '未找到相关文件。' : 'No relevant files found.'
                break
            case 'low_score':
                message = language === 'zh'
                    ? `未找到足够相关的代码（最高相关度: ${data.bestScore}，阈值: ${data.threshold}）。`
                    : `No highly relevant code found (Best score: ${data.bestScore}, Threshold: ${data.threshold}).`
                break
            case 'error':
                message = language === 'zh' ? '搜索过程中发生错误。' : 'An error occurred during search.'
                break
        }

        store.updateSearchPart(assistantId, searchPartId, message, false, false)
        store.finalizeSearchPart(assistantId, searchPartId)
    }
}

export const retrievalService = new RetrievalService()
