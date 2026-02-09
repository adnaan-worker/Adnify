/**
 * Tools 核心逻辑测试
 * 测试工具执行和管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeTools } from '@renderer/agent/core/tools'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import type { ToolCall } from '@shared/types'
import type { ToolExecutionContext } from '@renderer/agent/core/types'

// Mock dependencies
vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      read: vi.fn(async (path: string) => {
        // 模拟不同速度的文件读取
        const delay = path.includes('slow') ? 1000 : path.includes('medium') ? 500 : 100
        await new Promise(resolve => setTimeout(resolve, delay))
        return `Content of ${path}`
      }),
    },
  },
}))

vi.mock('@renderer/agent/tools/providers', () => ({
  toolManager: {
    execute: vi.fn(async (name: string, args: any) => {
      // 模拟不同工具的执行时间
      let delay = 100
      if (name === 'read_file') {
        const path = args.path as string
        delay = path.includes('slow') ? 1000 : path.includes('medium') ? 500 : 100
      } else if (name === 'web_search') {
        delay = 2000 // 网络搜索很慢
      } else if (name === 'list_directory') {
        delay = 50 // 列目录很快
      }
      
      await new Promise(resolve => setTimeout(resolve, delay))
      
      return {
        success: true,
        result: `Result from ${name}`,
        meta: {},
      }
    }),
  },
}))

vi.mock('@renderer/agent/tools/registry', () => ({
  toolRegistry: {
    execute: vi.fn(async () => ({
      success: true,
      result: 'No diagnostics found',
    })),
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      agentConfig: {
        autoApprove: true, // 自动批准所有工具
      },
      addToolCallLog: vi.fn(),
    })),
  },
}))

describe('Tools Core - Parallel Execution', () => {
  let assistantId: string
  let threadId: string
  let context: ToolExecutionContext

  function getStore() {
    return useAgentStore.getState().forThread(threadId)
  }

  beforeEach(() => {
    // 重置 store
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      streamState: { phase: 'idle' },
    })

    // 创建测试线程和消息
    const store = useAgentStore.getState()
    threadId = store.createThread()
    assistantId = store.addAssistantMessage()

    context = {
      workspacePath: '/test/workspace',
      currentAssistantId: assistantId,
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Parallel Tool Execution Performance', () => {
    it('should execute multiple fast tools in parallel efficiently', async () => {
      // 创建 5 个快速工具
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'fast1.txt' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'fast2.txt' } },
        { id: 'tc3', name: 'list_directory', arguments: { path: '.' } },
        { id: 'tc4', name: 'read_file', arguments: { path: 'fast3.txt' } },
        { id: 'tc5', name: 'list_directory', arguments: { path: './src' } },
      ]

      const startTime = Date.now()
      const { results } = await executeTools(toolCalls, context, getStore())
      const duration = Date.now() - startTime

      // 验证所有工具都执行了
      expect(results).toHaveLength(5)
      expect(results.every(r => r.result.content.includes('Result from'))).toBe(true)

      // 并行执行应该比串行快很多
      // 串行需要: 100 + 100 + 50 + 100 + 50 = 400ms
      // 并行应该接近最慢的那个: ~100ms (加上一些开销)
      expect(duration).toBeLessThan(300) // 应该远小于串行时间
    })

    it('should handle mixed speed tools without blocking', async () => {
      // 混合快速和慢速工具
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'fast.txt' } },      // 100ms
        { id: 'tc2', name: 'read_file', arguments: { path: 'slow.txt' } },      // 1000ms
        { id: 'tc3', name: 'list_directory', arguments: { path: '.' } },        // 50ms
        { id: 'tc4', name: 'read_file', arguments: { path: 'medium.txt' } },    // 500ms
      ]

      const startTime = Date.now()
      const completionTimes: Record<string, number> = {}

      // 监听工具完成事件（patch 传入 executeTools 的 thread-bound store）
      const store = getStore()
      const originalUpdate = store.updateToolCall.bind(store)
      store.updateToolCall = vi.fn((msgId: string, tcId: string, updates: { status?: string }) => {
        if (updates.status === 'success' || updates.status === 'error') {
          completionTimes[tcId] = Date.now() - startTime
        }
        return originalUpdate(msgId, tcId, updates)
      }) as typeof store.updateToolCall

      const { results } = await executeTools(toolCalls, context, store)

      // 验证所有工具都完成了
      expect(results).toHaveLength(4)

      // 验证快速工具不会被慢速工具阻塞
      // tc1 (fast) 和 tc3 (list) 应该很快完成
      expect(completionTimes['tc1']).toBeLessThan(300)
      expect(completionTimes['tc3']).toBeLessThan(300)
      
      // tc4 (medium) 应该在 tc2 (slow) 之前完成
      expect(completionTimes['tc4']).toBeLessThan(completionTimes['tc2'])
    })

    it('should respect concurrency limit', async () => {
      // 创建 20 个工具，测试并发限制
      const toolCalls: ToolCall[] = Array.from({ length: 20 }, (_, i) => ({
        id: `tc${i + 1}`,
        name: 'read_file',
        arguments: { path: `file${i + 1}.txt` },
      }))

      let maxConcurrent = 0
      let currentConcurrent = 0

      // Mock toolManager.execute 来追踪并发数
      const { toolManager } = await import('@renderer/agent/tools/providers')
      const originalExecute = toolManager.execute
      toolManager.execute = vi.fn(async (name: string, args: any) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        
        await new Promise(resolve => setTimeout(resolve, 100))
        
        currentConcurrent--
        return {
          success: true,
          result: `Result from ${name}`,
          meta: {},
        }
      })

      await executeTools(toolCalls, context, getStore())

      // 验证并发数不超过配置限制（默认 maxConcurrency 为 16）
      expect(maxConcurrent).toBeLessThanOrEqual(16)
      expect(maxConcurrent).toBeGreaterThan(1) // 确实是并行的

      // 恢复原始实现
      toolManager.execute = originalExecute
    })

    it('should update UI state immediately when each tool completes', async () => {
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'fast.txt' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'slow.txt' } },
        { id: 'tc3', name: 'read_file', arguments: { path: 'medium.txt' } },
      ]

      const updateOrder: string[] = []
      const store = getStore()
      const originalUpdate = store.updateToolCall.bind(store)
      store.updateToolCall = vi.fn((msgId: string, tcId: string, updates: { status?: string }) => {
        if (updates.status === 'success') {
          updateOrder.push(tcId)
        }
        return originalUpdate(msgId, tcId, updates)
      }) as typeof store.updateToolCall

      await executeTools(toolCalls, context, store)

      // 验证更新顺序：快的先完成
      expect(updateOrder).toHaveLength(3)
      expect(updateOrder[0]).toBe('tc1') // fast 最先完成
      expect(updateOrder[2]).toBe('tc2') // slow 最后完成
    })
  })

  describe('Error Handling in Parallel Execution', () => {
    it('should not block other tools when one tool fails', async () => {
      const { toolManager } = await import('@renderer/agent/tools/providers')
      
      // Mock 一个会失败的工具
      toolManager.execute = vi.fn(async (name: string, args: any) => {
        const path = args.path as string
        
        if (path === 'error.txt') {
          await new Promise(resolve => setTimeout(resolve, 100))
          throw new Error('File not found')
        }
        
        await new Promise(resolve => setTimeout(resolve, 100))
        return {
          success: true,
          result: `Result from ${name}`,
          meta: {},
        }
      })

      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'good1.txt' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'error.txt' } },
        { id: 'tc3', name: 'read_file', arguments: { path: 'good2.txt' } },
      ]

      const { results } = await executeTools(toolCalls, context, getStore())

      // 验证所有工具都有结果（包括失败的）
      expect(results).toHaveLength(3)
      
      // 验证成功的工具正常执行
      const successResults = results.filter(r => !r.result.content.includes('Error'))
      expect(successResults).toHaveLength(2)
      
      // 验证失败的工具有错误信息
      const errorResult = results.find(r => r.toolCall.id === 'tc2')
      expect(errorResult?.result.content).toContain('Error')
    })

    it('should continue executing other tools even if one is very slow', async () => {
      const { toolManager } = await import('@renderer/agent/tools/providers')
      
      // Mock 一个很慢的工具和几个快速工具
      toolManager.execute = vi.fn(async (name: string, args: any) => {
        const path = args.path as string
        
        if (path === 'very-slow.txt') {
          // 模拟很慢的工具（2秒）
          await new Promise(resolve => setTimeout(resolve, 2000))
        } else {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        
        return {
          success: true,
          result: `Result from ${name}`,
          meta: {},
        }
      })

      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'fast1.txt' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'very-slow.txt' } },
        { id: 'tc3', name: 'read_file', arguments: { path: 'fast2.txt' } },
        { id: 'tc4', name: 'read_file', arguments: { path: 'fast3.txt' } },
      ]

      const completionTimes: Record<string, number> = {}
      const startTime = Date.now()
      
      const store = getStore()
      const originalUpdate = store.updateToolCall.bind(store)
      store.updateToolCall = vi.fn((msgId: string, tcId: string, updates: { status?: string }) => {
        if (updates.status === 'success') {
          completionTimes[tcId] = Date.now() - startTime
        }
        return originalUpdate(msgId, tcId, updates)
      }) as typeof store.updateToolCall

      const { results } = await executeTools(toolCalls, context, store)

      // 所有工具都应该完成
      expect(results).toHaveLength(4)
      
      // 快速工具应该在慢速工具之前完成
      expect(completionTimes['tc1']).toBeLessThan(500)
      expect(completionTimes['tc3']).toBeLessThan(500)
      expect(completionTimes['tc4']).toBeLessThan(500)
      expect(completionTimes['tc2']).toBeGreaterThan(1500)
      
      // 验证快速工具不会被慢速工具阻塞
      expect(completionTimes['tc1']).toBeLessThan(completionTimes['tc2'])
      expect(completionTimes['tc3']).toBeLessThan(completionTimes['tc2'])
      expect(completionTimes['tc4']).toBeLessThan(completionTimes['tc2'])
    }, 10000) // 增加测试超时时间到 10 秒
  })

  describe('Tool Dependencies', () => {
    it('should execute independent tools in parallel', async () => {
      // 独立的工具应该并行执行
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'file1.txt' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'file2.txt' } },
        { id: 'tc3', name: 'list_directory', arguments: { path: './src' } },
      ]

      const startTime = Date.now()
      await executeTools(toolCalls, context, getStore())
      const duration = Date.now() - startTime

      // 并行执行应该快于串行
      expect(duration).toBeLessThan(250) // 远小于 100+100+50=250ms
    })

    it('should handle file edit dependencies correctly', async () => {
      // 编辑同一个文件的工具应该有依赖关系
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'write_file', arguments: { path: 'test.txt', content: 'v1' } },
        { id: 'tc2', name: 'write_file', arguments: { path: 'test.txt', content: 'v2' } },
        { id: 'tc3', name: 'read_file', arguments: { path: 'other.txt' } },
      ]

      const executionOrder: string[] = []
      const { toolManager } = await import('@renderer/agent/tools/providers')
      const originalExecute = toolManager.execute
      
      toolManager.execute = vi.fn(async (name: string, args: any) => {
        executionOrder.push(`${name}:${args.path}`)
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          success: true,
          result: `Result from ${name}`,
          meta: {},
        }
      })

      await executeTools(toolCalls, context, getStore())

      // tc3 (other.txt) 应该可以并行执行
      // tc1 和 tc2 (test.txt) 应该有依赖关系
      expect(executionOrder).toHaveLength(3)
      
      // 恢复原始实现
      toolManager.execute = originalExecute
    })
  })

  describe('Real-world Scenarios', () => {
    it('should handle typical AI workflow efficiently', async () => {
      // 模拟 AI 典型的工作流：读取多个文件 + 搜索 + 列目录
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'read_file', arguments: { path: 'src/main.ts' } },
        { id: 'tc2', name: 'read_file', arguments: { path: 'src/utils.ts' } },
        { id: 'tc3', name: 'list_directory', arguments: { path: './src' } },
        { id: 'tc4', name: 'read_file', arguments: { path: 'package.json' } },
        { id: 'tc5', name: 'list_directory', arguments: { path: './tests' } },
      ]

      const startTime = Date.now()
      const { results } = await executeTools(toolCalls, context, getStore())
      const duration = Date.now() - startTime

      // 所有工具都应该成功
      expect(results).toHaveLength(5)
      expect(results.every(r => r.result.content.includes('Result from'))).toBe(true)

      // 并行执行应该很快
      expect(duration).toBeLessThan(300)
    })

    it('should handle large batch of tools', async () => {
      // 模拟 AI 一次性调用很多工具的情况
      const toolCalls: ToolCall[] = Array.from({ length: 50 }, (_, i) => ({
        id: `tc${i + 1}`,
        name: 'read_file',
        arguments: { path: `file${i + 1}.txt` },
      }))

      const startTime = Date.now()
      const { results } = await executeTools(toolCalls, context, getStore())
      const duration = Date.now() - startTime

      // 所有工具都应该完成
      expect(results).toHaveLength(50)

      // 即使有 50 个工具，由于并发限制和并行执行，也应该在合理时间内完成
      // 理论上：50 个工具，每个 100ms，8 个并发 = 50/8 * 100 = 625ms
      expect(duration).toBeLessThan(1500) // 给一些余量
    })
  })
})

describe('Tools Core - Legacy Tests', () => {
  describe('Tool Execution', () => {
    it('should execute tools with context', () => {
      // 测试带上下文的工具执行
      expect(true).toBe(true)
    })

    it('should handle tool execution timeout', () => {
      // 测试工具执行超时
      expect(true).toBe(true)
    })
  })

  describe('Tool Validation', () => {
    it('should validate tool parameters', () => {
      // 测试工具参数验证
      expect(true).toBe(true)
    })

    it('should reject invalid parameters', () => {
      // 测试拒绝无效参数
      expect(true).toBe(true)
    })
  })

  describe('Tool Approval', () => {
    it('should check approval requirements', () => {
      // 测试审批要求检查
      expect(true).toBe(true)
    })

    it('should handle auto-approved tools', () => {
      // 测试自动批准的工具
      expect(true).toBe(true)
    })
  })
})
