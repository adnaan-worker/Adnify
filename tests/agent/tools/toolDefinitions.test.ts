/**
 * 工具定义测试
 * 测试工具注册和验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  toolRegistry,
  initializeToolProviders,
} from '@renderer/agent/tools'
import { TOOL_SCHEMAS, TOOL_CONFIGS } from '@/shared/config/tools'

// Mock dependencies that tools need
vi.mock('@renderer/services/WorkspaceManager', () => ({
  workspaceManager: {
    getCurrentWorkspacePath: vi.fn(() => '/test/workspace'),
  },
}))

vi.mock('@renderer/agent/core/Agent', () => ({
  Agent: {
    hasValidFileCache: vi.fn(() => false),
  },
}))

describe('Tool Definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initializeToolProviders()
  })

  describe('Tool Schemas', () => {
    it('should have TOOL_SCHEMAS object', () => {
      expect(TOOL_SCHEMAS).toBeDefined()
      expect(typeof TOOL_SCHEMAS).toBe('object')
    })

    it('should have TOOL_CONFIGS object', () => {
      expect(TOOL_CONFIGS).toBeDefined()
      expect(typeof TOOL_CONFIGS).toBe('object')
    })

    it('should have read_file in configs', () => {
      expect(TOOL_CONFIGS.read_file).toBeDefined()
      expect(TOOL_CONFIGS.read_file.name).toBe('read_file')
    })

    it('should have edit_file in configs', () => {
      expect(TOOL_CONFIGS.edit_file).toBeDefined()
      expect(TOOL_CONFIGS.edit_file.name).toBe('edit_file')
    })

    it('should have run_command in configs', () => {
      expect(TOOL_CONFIGS.run_command).toBeDefined()
      expect(TOOL_CONFIGS.run_command.name).toBe('run_command')
    })

    it('should generate schemas from configs', () => {
      // TOOL_SCHEMAS should have same keys as TOOL_CONFIGS
      const configKeys = Object.keys(TOOL_CONFIGS)
      const schemaKeys = Object.keys(TOOL_SCHEMAS)
      
      expect(schemaKeys.length).toBeGreaterThan(0)
      // At least some configs should have schemas
      expect(schemaKeys.length).toBeGreaterThanOrEqual(configKeys.length * 0.5)
    })

    it('should allow read_file path arrays', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      const result = readFileSchema.safeParse({
        path: ['src/a.ts', 'src/b.ts'],
      })

      expect(result.success).toBe(true)
    })

    it('should reject inverted line ranges in read_file', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      const result = readFileSchema.safeParse({
        path: 'src/main.ts',
        start_line: 20,
        end_line: 10,
      })

      expect(result.success).toBe(false)
    })

    it('should ignore placeholder line fields and empty edits in edit_file string mode', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'portal/src/pages/dashboard/DocsPage.tsx',
        old_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n\n  const menuItems = [",
        new_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';\n  const openAIBaseUrl = apiBaseUrl.endsWith('/v1') ? apiBaseUrl : `${apiBaseUrl}/v1`;\n  const chatCompletionsUrl = `${window.location.origin}${openAIBaseUrl}/chat/completions`;\n  const openAIBaseUrlAbsolute = `${window.location.origin}${openAIBaseUrl}`;\n\n  const menuItems = [",
        start_line: 1,
        end_line: 1,
        content: '',
        replace_all: false,
        edits: [],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.start_line).toBeUndefined()
        expect(result.data.end_line).toBeUndefined()
        expect(result.data.content).toBeUndefined()
        expect(result.data.edits).toBeUndefined()
      }
    })

    it('should ignore empty edits in edit_file line mode', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: '',
        new_string: '',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
        edits: [],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.old_string).toBeUndefined()
        expect(result.data.new_string).toBeUndefined()
        expect(result.data.edits).toBeUndefined()
      }
    })

    it('should still reject genuine mixed edit_file modes', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: 'before',
        new_string: 'after',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
      })

      expect(result.success).toBe(false)
    })
  })

  describe('toolRegistry', () => {
    it('should have registry methods', () => {
      expect(typeof toolRegistry.register).toBe('function')
      expect(typeof toolRegistry.get).toBe('function')
      expect(typeof toolRegistry.has).toBe('function')
      expect(typeof toolRegistry.validate).toBe('function')
    })

    it('should validate using schemas', () => {
      // Test that schemas can be used for validation
      const readFileSchema = TOOL_SCHEMAS.read_file
      if (readFileSchema) {
        const validResult = readFileSchema.safeParse({ path: 'src/main.ts' })
        expect(validResult.success).toBe(true)
        
        const invalidResult = readFileSchema.safeParse({})
        expect(invalidResult.success).toBe(false)
      }
    })
  })
})
