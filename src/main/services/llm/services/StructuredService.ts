/**
 * 结构化输出服务 - 使用 AI SDK 6.0 generateText + Output
 */

import { generateText, Output, generateObject } from 'ai'
import { z } from 'zod'
import { logger } from '@shared/utils/Logger'
import { createModel } from '../modelFactory'
import { applyCaching, getCacheConfig } from '../core/PromptCache'
import { LLMError, convertUsage } from '../types'
import type { LLMResponse, CodeAnalysis, Refactoring, CodeFix, TestCase } from '../types'
import type { LLMConfig } from '@shared/types'

// ============================================
// Zod Schemas
// ============================================

const CodeIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
  code: z.string().optional(),
  source: z.string().optional(),
})

const CodeAnalysisSchema = z.object({
  issues: z.array(CodeIssueSchema),
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      changes: z
        .array(
          z.object({
            line: z.number(),
            oldText: z.string(),
            newText: z.string(),
          })
        )
        .optional(),
    })
  ),
  summary: z.string(),
})

const RefactoringSchema = z.object({
  refactorings: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      changes: z.array(
        z.object({
          type: z.enum(['replace', 'insert', 'delete']),
          startLine: z.number(),
          startColumn: z.number(),
          endLine: z.number(),
          endColumn: z.number(),
          newText: z.string().optional(),
        })
      ),
      explanation: z.string(),
    })
  ),
})

const CodeFixSchema = z.object({
  fixes: z.array(
    z.object({
      diagnosticIndex: z.number(),
      title: z.string(),
      description: z.string(),
      changes: z.array(
        z.object({
          startLine: z.number(),
          startColumn: z.number(),
          endLine: z.number(),
          endColumn: z.number(),
          newText: z.string(),
        })
      ),
      confidence: z.enum(['high', 'medium', 'low']),
    })
  ),
})

const TestCaseSchema = z.object({
  testCases: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      code: z.string(),
      type: z.enum(['unit', 'integration', 'edge-case']),
    })
  ),
  setup: z.string().optional(),
  teardown: z.string().optional(),
})

// ============================================
// 服务实现
// ============================================

export class StructuredService {
  /**
   * 代码分析
   */
  async analyzeCode(params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }): Promise<LLMResponse<CodeAnalysis>> {
    logger.system.info('[StructuredService] Analyzing code')

    try {
      const model = createModel(params.config)

      // 应用缓存
      const cacheConfig = getCacheConfig(params.config.provider)
      const messages = applyCaching(
        [
          {
            role: 'user',
            content: `Analyze the following ${params.language} code and return a structured analysis.

File: ${params.filePath}

\`\`\`${params.language}
${params.code}
\`\`\`

Return a JSON object with:
- issues: array of code issues (severity, message, line, column)
- suggestions: array of improvement suggestions (title, description, priority)
- summary: brief text summary`,
          },
        ],
        cacheConfig
      )

      const result = await generateText({
        model,
        messages,
        experimental_output: Output.object({
          schema: CodeAnalysisSchema as any,
        }),
      })

      const data = result.experimental_output as unknown as CodeAnalysis

      return {
        data,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Code analysis failed:', llmError)
      throw llmError
    }
  }

  /**
   * 代码重构建议
   */
  async suggestRefactoring(params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }): Promise<LLMResponse<Refactoring>> {
    logger.system.info('[StructuredService] Suggesting refactoring')

    try {
      const model = createModel(params.config)

      const cacheConfig = getCacheConfig(params.config.provider)
      const messages = applyCaching(
        [
          {
            role: 'user',
            content: `Suggest refactorings for the following ${params.language} code.

Intent: ${params.intent}

\`\`\`${params.language}
${params.code}
\`\`\`

Return refactoring suggestions with precise line/column positions.`,
          },
        ],
        cacheConfig
      )

      const result = await generateText({
        model,
        messages,
        experimental_output: Output.object({
          schema: RefactoringSchema as any,
        }),
      })

      const data = result.experimental_output as unknown as Refactoring

      return {
        data,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Refactoring failed:', llmError)
      throw llmError
    }
  }

  /**
   * 错误修复建议
   */
  async suggestFixes(params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }): Promise<LLMResponse<CodeFix>> {
    logger.system.info('[StructuredService] Suggesting fixes')

    try {
      const model = createModel(params.config)

      const diagnosticsText = params.diagnostics
        .map((d, i) => `${i}. Line ${d.line}: ${d.message}`)
        .join('\n')

      const cacheConfig = getCacheConfig(params.config.provider)
      const messages = applyCaching(
        [
          {
            role: 'user',
            content: `Suggest fixes for the following ${params.language} errors:

Diagnostics:
${diagnosticsText}

Code:
\`\`\`${params.language}
${params.code}
\`\`\`

Return fix suggestions with precise line/column positions.`,
          },
        ],
        cacheConfig
      )

      const result = await generateText({
        model,
        messages,
        experimental_output: Output.object({
          schema: CodeFixSchema as any,
        }),
      })

      const data = result.experimental_output as unknown as CodeFix

      return {
        data,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Fix suggestion failed:', llmError)
      throw llmError
    }
  }

  /**
   * 生成测试用例
   */
  async generateTests(params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }): Promise<LLMResponse<TestCase>> {
    logger.system.info('[StructuredService] Generating tests')

    try {
      const model = createModel(params.config)

      const cacheConfig = getCacheConfig(params.config.provider)
      const messages = applyCaching(
        [
          {
            role: 'user',
            content: `Generate test cases for the following ${params.language} code${params.framework ? ` using ${params.framework}` : ''}.

\`\`\`${params.language}
${params.code}
\`\`\`

Return comprehensive test cases including unit tests, integration tests, and edge cases.`,
          },
        ],
        cacheConfig
      )

      const result = await generateText({
        model,
        messages,
        experimental_output: Output.object({
          schema: TestCaseSchema as any,
        }),
      })

      const data = result.experimental_output as unknown as TestCase

      return {
        data,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Test generation failed:', llmError)
      throw llmError
    }
  }

  async analyzeCodeStream(
    params: {
      config: LLMConfig
      code: string
      language: string
      filePath: string
    },
    onPartial: (partial: Partial<CodeAnalysis>) => void
  ): Promise<LLMResponse<CodeAnalysis>> {
    logger.system.info('[StructuredService] Analyzing code (streaming)')

    try {
      const model = createModel(params.config)

      const cacheConfig = getCacheConfig(params.config.provider)
      const messages = applyCaching(
        [
          {
            role: 'user',
            content: `Analyze the following ${params.language} code:

File: ${params.filePath}

\`\`\`${params.language}
${params.code}
\`\`\`

Return structured analysis with issues, suggestions, and summary.`,
          },
        ],
        cacheConfig
      )

      const result = await generateText({
        model,
        messages,
        experimental_output: Output.object({
          schema: CodeAnalysisSchema as any,
        }),
      })

      const data = result.experimental_output as unknown as CodeAnalysis
      onPartial(data)

      return {
        data,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Streaming analysis failed:', llmError)
      throw llmError
    }
  }

  /**
   * 通用结构化对象生成（使用 generateObject）
   */
  async generateStructuredObject<T extends z.ZodType>(params: {
    config: LLMConfig
    schema: T | any // 支持 Zod schema 或 JSON Schema
    system: string
    prompt: string
  }): Promise<LLMResponse<z.infer<T>>> {
    logger.system.info('[StructuredService] Generating structured object')

    try {
      const model = createModel(params.config)

      // 如果传入的是 JSON Schema，转换为 Zod schema
      let zodSchema: z.ZodType
      if (params.schema._def) {
        // 已经是 Zod schema
        zodSchema = params.schema
      } else {
        // 是 JSON Schema，需要转换（简化版，只支持常见类型）
        zodSchema = jsonSchemaToZod(params.schema)
      }

      const result = await generateObject({
        model,
        schema: zodSchema,
        system: params.system,
        prompt: params.prompt,
        temperature: params.config.temperature,
      })

      return {
        data: result.object as z.infer<T>,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Structured object generation failed:', llmError)
      throw llmError
    }
  }
}

/**
 * 简化的 JSON Schema 到 Zod 转换器
 * 只支持常见的类型，用于 IPC 传递
 */
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (schema.type === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, value] of Object.entries(schema.properties || {})) {
      const propSchema = value as any
      shape[key] = jsonSchemaToZod(propSchema)
      if (propSchema.description) {
        shape[key] = shape[key].describe(propSchema.description)
      }
    }
    return z.object(shape)
  }
  
  if (schema.type === 'array') {
    return z.array(jsonSchemaToZod(schema.items))
  }
  
  if (schema.type === 'string') {
    if (schema.enum) {
      return z.enum(schema.enum as [string, ...string[]])
    }
    return z.string()
  }
  
  if (schema.type === 'number') {
    return z.number()
  }
  
  if (schema.type === 'boolean') {
    return z.boolean()
  }
  
  return z.any()
}
