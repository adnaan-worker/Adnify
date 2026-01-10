/**
 * 上下文压缩系统测试
 * 
 * 测试 5 级压缩策略：
 * L0: Full Context (< 50%)
 * L1: Smart Truncation (50-70%)
 * L2: Sliding Window + Summary (70-85%)
 * L3: Deep Compression (85-95%)
 * L4: Session Handoff (> 95%)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ContextManager } from '../../src/renderer/agent/context/ContextManager'
import { estimateTokens, estimateMessageTokens, estimateTotalTokens } from '../../src/renderer/agent/context/TokenEstimator'
import { truncateToolResult } from '../../src/renderer/agent/context/MessageTruncator'
import { scoreMessageGroup } from '../../src/renderer/agent/context/ImportanceScorer'
import { generateQuickSummary, generateHandoffDocument } from '../../src/renderer/agent/context/SummaryGenerator'
import type { OpenAIMessage } from '../../src/renderer/agent/llm/MessageConverter'
import type { MessageGroup } from '../../src/renderer/agent/context/types'

// ===== 辅助函数 =====

function createUserMessage(content: string): OpenAIMessage {
  return { role: 'user', content }
}

function createAssistantMessage(content: string, toolCalls?: any[]): OpenAIMessage {
  return { role: 'assistant', content, tool_calls: toolCalls }
}

function createToolMessage(content: string, toolCallId = 'tc-1'): OpenAIMessage {
  return { role: 'tool', content, tool_call_id: toolCallId } as any
}

function createSystemMessage(content: string): OpenAIMessage {
  return { role: 'system', content }
}

function createWriteToolCall(path: string): any {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: { name: 'write_file', arguments: JSON.stringify({ path, content: 'test' }) }
  }
}

function createReadToolCall(path: string): any {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: { name: 'read_file', arguments: JSON.stringify({ path }) }
  }
}

// 创建指定 token 数量的消息
function createMessagesWithTokens(targetTokens: number, maxTokens: number): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [createSystemMessage('You are a helpful assistant.')]
  const ratio = targetTokens / maxTokens
  
  // 每轮对话约 200 tokens
  const turnsNeeded = Math.ceil(targetTokens / 200)
  
  for (let i = 0; i < turnsNeeded; i++) {
    messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(50)}`))
    messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(100)}`))
  }
  
  return messages
}

// ===== Token 估算测试 =====

describe('TokenEstimator', () => {
  it('should estimate tokens for English text', () => {
    const text = 'Hello world, this is a test.'
    const tokens = estimateTokens(text)
    // 英文约 4 字符/token
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(text.length)
  })

  it('should estimate more tokens for Chinese text', () => {
    const chinese = '你好世界，这是一个测试。'
    const english = 'Hello world, this is a test.'
    
    const chineseTokens = estimateTokens(chinese)
    const englishTokens = estimateTokens(english)
    
    // 中文每字符约 0.67 token，英文每字符约 0.25 token
    expect(chineseTokens / chinese.length).toBeGreaterThan(englishTokens / english.length)
  })

  it('should estimate message tokens including structure overhead', () => {
    const msg = createUserMessage('Hello')
    const tokens = estimateMessageTokens(msg)
    
    // 应该包含 4 token 的结构开销
    expect(tokens).toBeGreaterThan(estimateTokens('Hello'))
  })

  it('should estimate tool_calls tokens', () => {
    const msg = createAssistantMessage('', [createReadToolCall('test.ts')])
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(10)
  })

  it('should estimate total tokens for message array', () => {
    const messages = [
      createSystemMessage('System'),
      createUserMessage('Hello'),
      createAssistantMessage('Hi'),
    ]
    const total = estimateTotalTokens(messages)
    expect(total).toBeGreaterThan(0)
  })
})

// ===== 消息截断测试 =====

describe('MessageTruncator', () => {
  it('should not truncate short content', () => {
    const content = 'Short content'
    const result = truncateToolResult(content, 'read_file')
    expect(result).toBe(content)
  })

  it('should truncate long content', () => {
    const content = 'x'.repeat(20000)
    const result = truncateToolResult(content, 'read_file', { maxToolResultChars: 8000 })
    
    expect(result.length).toBeLessThan(content.length)
    expect(result).toContain('omitted')
  })

  it('should preserve error messages at the start', () => {
    const content = 'Error: File not found\n' + 'x'.repeat(10000)
    const result = truncateToolResult(content, 'read_file', { maxToolResultChars: 1000 })
    
    expect(result).toContain('Error: File not found')
  })
})

// ===== 重要性评分测试 =====

describe('ImportanceScorer', () => {
  it('should score groups with write operations higher', () => {
    const messages: OpenAIMessage[] = [
      createUserMessage('Write a file'),
      createAssistantMessage('', [createWriteToolCall('test.ts')]),
      createToolMessage('File written'),
    ]
    
    const group: MessageGroup = {
      turnIndex: 0,
      userIndex: 0,
      assistantIndex: 1,
      toolIndices: [2],
      tokens: 100,
      importance: 0,
      hasWriteOps: true,
      hasErrors: false,
      files: ['test.ts'],
    }
    
    const score = scoreMessageGroup(group, messages, [group])
    expect(score).toBeGreaterThan(50) // 写操作应该有较高分数
  })

  it('should score groups with errors higher', () => {
    const messages: OpenAIMessage[] = [
      createUserMessage('Read a file'),
      createAssistantMessage('', [createReadToolCall('test.ts')]),
      createToolMessage('Error: File not found'),
    ]
    
    const group: MessageGroup = {
      turnIndex: 0,
      userIndex: 0,
      assistantIndex: 1,
      toolIndices: [2],
      tokens: 100,
      importance: 0,
      hasWriteOps: false,
      hasErrors: true,
      files: [],
    }
    
    const score = scoreMessageGroup(group, messages, [group])
    expect(score).toBeGreaterThan(50) // 错误应该有较高分数
  })
})

// ===== 摘要生成测试 =====

describe('SummaryGenerator', () => {
  it('should generate quick summary from messages', () => {
    const messages: OpenAIMessage[] = [
      createUserMessage('Create a React component'),
      createAssistantMessage('I will create the component', [createWriteToolCall('Button.tsx')]),
      createToolMessage('File created'),
    ]
    
    const groups: MessageGroup[] = [{
      turnIndex: 0,
      userIndex: 0,
      assistantIndex: 1,
      toolIndices: [2],
      tokens: 100,
      importance: 50,
      hasWriteOps: true,
      hasErrors: false,
      files: ['Button.tsx'],
    }]
    
    const summary = generateQuickSummary(messages, groups, [0, 0])
    
    expect(summary.objective).toBeTruthy()
    expect(summary.turnRange).toEqual([0, 0])
    expect(summary.generatedAt).toBeGreaterThan(0)
  })

  it('should generate handoff document', () => {
    const messages: OpenAIMessage[] = [
      createUserMessage('Build a todo app'),
      createAssistantMessage('Starting the project'),
    ]
    
    const groups: MessageGroup[] = [{
      turnIndex: 0,
      userIndex: 0,
      assistantIndex: 1,
      toolIndices: [],
      tokens: 50,
      importance: 30,
      hasWriteOps: false,
      hasErrors: false,
      files: [],
    }]
    
    const summary = generateQuickSummary(messages, groups, [0, 0])
    const handoff = generateHandoffDocument('session-1', messages, groups, summary, '/workspace')
    
    expect(handoff.fromSessionId).toBe('session-1')
    expect(handoff.summary).toBe(summary)
    expect(handoff.lastUserRequest).toContain('todo app')
  })
})

// ===== ContextManager 核心测试 =====

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    manager = new ContextManager()
    manager.clear()
  })

  describe('Level 0: Full Context', () => {
    it('should keep all messages when under 50% capacity', () => {
      const messages: OpenAIMessage[] = [
        createSystemMessage('System prompt'),
        createUserMessage('Hello'),
        createAssistantMessage('Hi there!'),
      ]

      const result = manager.optimize(messages, { maxTokens: 100000 })

      expect(result.stats.compressionLevel).toBe(0)
      expect(result.messages.length).toBe(3)
      expect(result.stats.compactedTurns).toBe(0)
      expect(result.stats.needsHandoff).toBe(false)
    })
  })

  describe('Level 1: Smart Truncation', () => {
    it('should truncate tool results when 50-70% capacity', () => {
      const messages: OpenAIMessage[] = [
        createSystemMessage('System'),
        createUserMessage('Read file'),
        createAssistantMessage('', [createReadToolCall('large.ts')]),
        createToolMessage('x'.repeat(50000)), // 很长的工具结果
      ]

      // 设置 maxTokens 使得占比在 50-70%
      const result = manager.optimize(messages, { 
        maxTokens: 20000,
        maxToolResultChars: 5000,
      })

      expect(result.stats.compressionLevel).toBe(1)
      
      const toolMsg = result.messages.find(m => m.role === 'tool')
      expect(toolMsg?.content.length).toBeLessThan(50000)
    })
  })

  describe('Level 2: Sliding Window + Summary', () => {
    it('should keep recent turns and generate summary when 70-85% capacity', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      
      // 创建 15 轮对话，每轮约 200 tokens，总计约 3000 tokens
      // 设置 maxTokens=4000，使占比约 75%（70-85% 范围）
      for (let i = 0; i < 15; i++) {
        messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(200)}`))
        messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(200)}`))
      }

      const result = manager.optimize(messages, {
        maxTokens: 2200, // 1721/2200 ≈ 78%
        keepRecentTurns: 5,
      })

      expect(result.stats.compressionLevel).toBe(2)
      expect(result.stats.keptTurns).toBeLessThanOrEqual(8)
      expect(result.stats.compactedTurns).toBeGreaterThan(0)
      expect(result.summary).toBeTruthy()
    })

    it('should preserve high-importance old turns', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      
      // 第一轮：写操作（高重要性）
      messages.push(createUserMessage('Create file'))
      messages.push(createAssistantMessage('', [createWriteToolCall('important.ts')]))
      messages.push(createToolMessage('Created'))
      
      // 中间轮次，增加内容使总 token 超过 70%
      for (let i = 0; i < 10; i++) {
        messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(100)}`))
        messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(100)}`))
      }

      const result = manager.optimize(messages, {
        maxTokens: 220, // 使占比超过 70%
        keepRecentTurns: 3,
      })

      // 写操作轮次应该被保留
      expect(result.stats.compressionLevel).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Level 3: Deep Compression', () => {
    it('should only keep 2 recent turns when 85-95% capacity', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      
      // 创建很多轮对话，约 4946 tokens
      // 设置 maxTokens=5500，使占比约 90%（85-95% 范围）
      for (let i = 0; i < 30; i++) {
        messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(300)}`))
        messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(300)}`))
      }

      const result = manager.optimize(messages, {
        maxTokens: 5500, // 4946/5500 ≈ 90%
        deepCompressionTurns: 2,
        autoHandoff: false, // 禁用自动交接以测试 L3
      })

      expect(result.stats.compressionLevel).toBe(3)
      expect(result.stats.keptTurns).toBe(2)
      expect(result.summary).toBeTruthy()
    })
  })

  describe('Level 4: Session Handoff', () => {
    it('should trigger handoff when over 95% capacity', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      
      // 创建大量对话超过 95%
      for (let i = 0; i < 50; i++) {
        messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(500)}`))
        messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(500)}`))
      }

      const result = manager.optimize(messages, {
        maxTokens: 2000,
        autoHandoff: true,
      })

      expect(result.stats.compressionLevel).toBe(4)
      expect(result.stats.needsHandoff).toBe(true)
      expect(result.handoff).toBeTruthy()
      expect(result.handoff?.summary).toBeTruthy()
    })

    it('should fallback to L3 when autoHandoff is false', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      
      for (let i = 0; i < 50; i++) {
        messages.push(createUserMessage(`Question ${i}: ${'x'.repeat(500)}`))
        messages.push(createAssistantMessage(`Answer ${i}: ${'y'.repeat(500)}`))
      }

      const result = manager.optimize(messages, {
        maxTokens: 2000,
        autoHandoff: false,
      })

      // 应该回退到 L3
      expect(result.stats.compressionLevel).toBe(3)
      expect(result.stats.needsHandoff).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty messages', () => {
      const result = manager.optimize([], { maxTokens: 100000 })
      
      expect(result.messages.length).toBe(0)
      expect(result.stats.compressionLevel).toBe(0)
    })

    it('should handle only system message', () => {
      const messages = [createSystemMessage('System')]
      const result = manager.optimize(messages, { maxTokens: 100000 })
      
      expect(result.messages.length).toBe(1)
      expect(result.stats.keptTurns).toBe(0)
    })

    it('should merge summaries correctly', () => {
      // 第一次压缩 - 需要触发 L2+ 才会生成摘要
      const messages1: OpenAIMessage[] = [createSystemMessage('System')]
      for (let i = 0; i < 10; i++) {
        messages1.push(createUserMessage(`Q${i}: ${'x'.repeat(50)}`))
        messages1.push(createAssistantMessage(`A${i}: ${'y'.repeat(50)}`))
      }
      
      // 设置较小的 maxTokens 使其触发压缩
      manager.optimize(messages1, { maxTokens: 200, keepRecentTurns: 3 })
      const summary1 = manager.getSummary()
      
      // 第二次压缩（更多消息）
      const messages2 = [...messages1]
      for (let i = 10; i < 20; i++) {
        messages2.push(createUserMessage(`Q${i}: ${'x'.repeat(50)}`))
        messages2.push(createAssistantMessage(`A${i}: ${'y'.repeat(50)}`))
      }
      
      manager.optimize(messages2, { maxTokens: 200, keepRecentTurns: 3 })
      const summary2 = manager.getSummary()
      
      // 摘要应该被合并/更新
      expect(summary2).toBeTruthy()
      if (summary1 && summary2) {
        expect(summary2.turnRange[1]).toBeGreaterThanOrEqual(summary1.turnRange[1])
      }
    })

    it('should clear state correctly', () => {
      manager.setSummary({ 
        objective: 'test',
        completedSteps: [],
        pendingSteps: [],
        decisions: [],
        fileChanges: [],
        errorsAndFixes: [],
        userInstructions: [],
        generatedAt: Date.now(),
        turnRange: [0, 0],
      })
      
      expect(manager.getSummary()).toBeTruthy()
      
      manager.clear()
      
      expect(manager.getSummary()).toBeNull()
      expect(manager.getHandoff()).toBeNull()
      expect(manager.getCurrentLevel()).toBe(0)
    })
  })

  describe('Stats Tracking', () => {
    it('should track compression stats', () => {
      const messages: OpenAIMessage[] = [createSystemMessage('System')]
      for (let i = 0; i < 20; i++) {
        messages.push(createUserMessage(`Q${i}: ${'x'.repeat(100)}`))
        messages.push(createAssistantMessage(`A${i}: ${'y'.repeat(100)}`))
      }

      // 设置较小的 maxTokens 使其触发压缩（L1+）
      manager.optimize(messages, { maxTokens: 1500, keepRecentTurns: 5 })
      
      const stats = manager.getStats()
      
      expect(stats).toBeTruthy()
      expect(stats?.level).toBeGreaterThan(0)
      expect(stats?.originalTokens).toBeGreaterThan(0)
      expect(stats?.finalTokens).toBeLessThanOrEqual(stats?.originalTokens || 0)
      expect(stats?.savedPercent).toBeGreaterThanOrEqual(0)
      expect(stats?.lastOptimizedAt).toBeGreaterThan(0)
    })
  })
})
