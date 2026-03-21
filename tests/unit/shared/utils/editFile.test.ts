import { describe, expect, it } from 'vitest'
import { normalizeEditFileArgs, resolveEditFileRequest } from '@/shared/utils/editFile'

describe('editFile utils', () => {
  it('normalizes placeholder line fields for string mode payloads', () => {
    const normalized = normalizeEditFileArgs({
      path: 'portal/src/pages/dashboard/DocsPage.tsx',
      old_string: 'before',
      new_string: 'after',
      start_line: 1,
      end_line: 1,
      content: '',
      replace_all: false,
      edits: [],
    })

    expect(normalized.start_line).toBeUndefined()
    expect(normalized.end_line).toBeUndefined()
    expect(normalized.content).toBeUndefined()
    expect(normalized.edits).toBeUndefined()
  })

  it('normalizes zeroed placeholder line fields for string mode payloads', () => {
    const normalized = normalizeEditFileArgs({
      path: 'portal/src/pages/dashboard/DocsPage.tsx',
      old_string: 'before',
      new_string: 'after',
      start_line: 0,
      end_line: 0,
      content: '',
      replace_all: false,
      edits: [],
    })

    expect(normalized.start_line).toBeUndefined()
    expect(normalized.end_line).toBeUndefined()
    expect(normalized.content).toBeUndefined()
    expect(normalized.edits).toBeUndefined()
  })

  it('resolves the example payload as string mode', () => {
    const result = resolveEditFileRequest({
      path: 'portal/src/pages/dashboard/DocsPage.tsx',
      old_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n\n  const menuItems = [",
      new_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';\n\n  const menuItems = [",
      start_line: 1,
      end_line: 1,
      content: '',
      replace_all: false,
      edits: [],
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'string') {
      expect(result.mode).toBe('string')
      expect(result.args.old_string).toContain("const DocsPage = () => {")
    }
  })

  it('resolves zeroed placeholder payloads as string mode', () => {
    const result = resolveEditFileRequest({
      path: 'portal/src/pages/dashboard/DocsPage.tsx',
      old_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n\n  const menuItems = [",
      new_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n  const apiBaseUrl = `${window.location.origin}/v1`;\n  const chatCompletionsUrl = `${apiBaseUrl}/chat/completions`;\n\n  const menuItems = [",
      start_line: 0,
      end_line: 0,
      content: '',
      replace_all: false,
      edits: [],
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'string') {
      expect(result.args.new_string).toContain('chatCompletionsUrl')
    }
  })

  it('resolves line mode while dropping empty string placeholders', () => {
    const result = resolveEditFileRequest({
      path: 'src/example.ts',
      old_string: '',
      new_string: '',
      start_line: 3,
      end_line: 4,
      content: 'const updated = true',
      edits: [],
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'line') {
      expect(result.mode).toBe('line')
      expect(result.args.start_line).toBe(3)
    }
  })

  it('rejects genuine mixed modes', () => {
    const result = resolveEditFileRequest({
      path: 'src/example.ts',
      old_string: 'before',
      new_string: 'after',
      start_line: 3,
      end_line: 4,
      content: 'const updated = true',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Cannot mix')
    }
  })
})
