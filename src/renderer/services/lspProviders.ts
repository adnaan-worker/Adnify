/**
 * LSP Monaco 提供者
 * 将 LSP 服务集成到 Monaco Editor
 */

import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'
import type * as Monaco from 'monaco-editor'

// 扩展 CompletionItem 类型以支持 LSP data 字段
interface CompletionItemWithData extends Monaco.languages.CompletionItem {
  data?: unknown
}

// LSP WorkspaceEdit 类型
interface LspTextEdit {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  newText: string
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: unknown[]
}

import {
  lspUriToPath,
  getHoverInfo,
  getCompletions,
  resolveCompletionItem,
  getSignatureHelp,
  findReferences,
  getCodeActions,
  formatDocument,
  formatRange,
  getDocumentSymbols,
  prepareRename,
  renameSymbol,
  goToTypeDefinition,
  goToImplementation,
  getInlayHints,
} from './lspService'

// LSP CompletionItemKind 到 Monaco CompletionItemKind 的映射
const completionKindMap: Record<number, number> = {
  1: 0,   // Text
  2: 1,   // Method
  3: 2,   // Function
  4: 3,   // Constructor
  5: 4,   // Field
  6: 5,   // Variable
  7: 6,   // Class
  8: 7,   // Interface
  9: 8,   // Module
  10: 9,  // Property
  11: 10, // Unit
  12: 11, // Value
  13: 12, // Enum
  14: 13, // Keyword
  15: 14, // Snippet
  16: 15, // Color
  17: 16, // File
  18: 17, // Reference
  19: 18, // Folder
  20: 19, // EnumMember
  21: 20, // Constant
  22: 21, // Struct
  23: 22, // Event
  24: 23, // Operator
  25: 24, // TypeParameter
}

// LSP SymbolKind 到 Monaco SymbolKind 的映射
const symbolKindMap: Record<number, number> = {
  1: 0,   // File
  2: 1,   // Module
  3: 2,   // Namespace
  4: 3,   // Package
  5: 4,   // Class
  6: 5,   // Method
  7: 6,   // Property
  8: 7,   // Field
  9: 8,   // Constructor
  10: 9,  // Enum
  11: 10, // Interface
  12: 11, // Function
  13: 12, // Variable
  14: 13, // Constant
  15: 14, // String
  16: 15, // Number
  17: 16, // Boolean
  18: 17, // Array
  19: 18, // Object
  20: 19, // Key
  21: 20, // Null
  22: 21, // EnumMember
  23: 22, // Struct
  24: 23, // Event
  25: 24, // Operator
  26: 25, // TypeParameter
}

/**
 * 注册所有 LSP 提供者
 */
export function registerLspProviders(monaco: typeof Monaco) {
  // 支持的语言列表
  const languages = [
    // TypeScript/JavaScript
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
    // Python
    'python',
    // Go
    'go',
    // Rust
    'rust',
    // C/C++
    'c', 'cpp',
    // Java
    'java',
    // Web
    'html', 'css', 'scss', 'less',
    // Data
    'json', 'yaml',
  ]

  // 悬停提供者
  monaco.languages.registerHoverProvider(languages, {
    provideHover: async (model, position) => {
      const modelUri = model.uri.toString()
      const filePath = lspUriToPath(modelUri)
      
      logger.lsp.info('[LSP Hover] Request:', { modelUri, filePath, line: position.lineNumber - 1, col: position.column - 1 })
      
      const result = await getHoverInfo(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      logger.lsp.info('[LSP Hover] Result:', result)

      if (!result || !result.contents) return null

      // 转换 LSP hover 内容到 Monaco 格式
      const contents: Monaco.IMarkdownString[] = []
      
      if (typeof result.contents === 'string') {
        contents.push({ value: result.contents })
      } else if (Array.isArray(result.contents)) {
        result.contents.forEach((c: any) => {
          if (typeof c === 'string') {
            contents.push({ value: c })
          } else if (c.value) {
            contents.push({ value: c.kind === 'markdown' ? c.value : `\`\`\`\n${c.value}\n\`\`\`` })
          }
        })
      } else if (result.contents.value) {
        const c = result.contents as { kind?: string; value: string }
        contents.push({ value: c.kind === 'markdown' ? c.value : `\`\`\`\n${c.value}\n\`\`\`` })
      }

      return {
        contents,
        range: result.range ? {
          startLineNumber: result.range.start.line + 1,
          startColumn: result.range.start.character + 1,
          endLineNumber: result.range.end.line + 1,
          endColumn: result.range.end.character + 1,
        } : undefined,
      }
    },
  })

  // 代码补全提供者
  monaco.languages.registerCompletionItemProvider(languages, {
    triggerCharacters: ['.', '/', '"', "'", '`', '<', '@', '#'],
    provideCompletionItems: async (model, position) => {
      const filePath = lspUriToPath(model.uri.toString())
      
      // 添加超时，避免 LSP 响应慢时阻塞补全
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), getEditorConfig().lsp.completionTimeoutMs))
      const completionPromise = getCompletions(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )
      
      const result = await Promise.race([completionPromise, timeoutPromise])

      if (!result) return { suggestions: [] }

      const items = result.items || result
      const suggestions: CompletionItemWithData[] = items.map((item: any) => {
        const kind = completionKindMap[item.kind] ?? 0
        
        return {
          label: item.label,
          kind,
          detail: item.detail,
          documentation: item.documentation 
            ? (typeof item.documentation === 'string' 
                ? item.documentation 
                : { value: item.documentation.value })
            : undefined,
          insertText: item.insertText || item.label,
          insertTextRules: item.insertTextFormat === 2 
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet 
            : undefined,
          range: undefined!, // Monaco 会自动计算，使用 undefined! 表示运行时会被填充
          sortText: item.sortText,
          filterText: item.filterText,
          preselect: item.preselect,
          // 保存原始 LSP item 用于 resolve
          data: item,
        }
      })

      return {
        suggestions,
        incomplete: result.isIncomplete || false,
      }
    },
    resolveCompletionItem: async (item) => {
      const itemWithData = item as CompletionItemWithData
      if (!itemWithData.data) return item

      const resolved = await resolveCompletionItem(itemWithData.data)
      if (resolved) {
        if (resolved.documentation) {
          item.documentation = typeof resolved.documentation === 'string'
            ? resolved.documentation
            : { value: resolved.documentation.value }
        }
        if (resolved.detail) {
          item.detail = resolved.detail
        }
      }
      return item
    },
  })

  // 签名帮助提供者
  monaco.languages.registerSignatureHelpProvider(languages, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await getSignatureHelp(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      if (!result || !result.signatures || result.signatures.length === 0) {
        return null
      }

      return {
        value: {
          signatures: result.signatures.map((sig: any) => ({
            label: sig.label,
            documentation: sig.documentation 
              ? (typeof sig.documentation === 'string' 
                  ? sig.documentation 
                  : { value: sig.documentation.value })
              : undefined,
            parameters: (sig.parameters || []).map((param: any) => ({
              label: param.label,
              documentation: param.documentation
                ? (typeof param.documentation === 'string'
                    ? param.documentation
                    : { value: param.documentation.value })
                : undefined,
            })),
          })),
          activeSignature: result.activeSignature || 0,
          activeParameter: result.activeParameter || 0,
        },
        dispose: () => {},
      }
    },
  })

  // 引用提供者
  monaco.languages.registerReferenceProvider(languages, {
    provideReferences: async (model, position, _context) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await findReferences(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      if (!result) return null

      return result.map((loc: any) => ({
        uri: monaco.Uri.parse(loc.uri),
        range: {
          startLineNumber: loc.range.start.line + 1,
          startColumn: loc.range.start.character + 1,
          endLineNumber: loc.range.end.line + 1,
          endColumn: loc.range.end.character + 1,
        },
      }))
    },
  })

  // 类型定义提供者
  monaco.languages.registerTypeDefinitionProvider(languages, {
    provideTypeDefinition: async (model, position) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await goToTypeDefinition(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      if (!result) return null

      return result.map((loc: any) => ({
        uri: monaco.Uri.parse(loc.uri),
        range: {
          startLineNumber: loc.range.start.line + 1,
          startColumn: loc.range.start.character + 1,
          endLineNumber: loc.range.end.line + 1,
          endColumn: loc.range.end.character + 1,
        },
      }))
    },
  })

  // 实现提供者
  monaco.languages.registerImplementationProvider(languages, {
    provideImplementation: async (model, position) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await goToImplementation(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      if (!result) return null

      return result.map((loc: any) => ({
        uri: monaco.Uri.parse(loc.uri),
        range: {
          startLineNumber: loc.range.start.line + 1,
          startColumn: loc.range.start.character + 1,
          endLineNumber: loc.range.end.line + 1,
          endColumn: loc.range.end.character + 1,
        },
      }))
    },
  })

  // 代码操作提供者（快速修复、重构）
  monaco.languages.registerCodeActionProvider(languages, {
    provideCodeActions: async (model, range, context) => {
      const filePath = lspUriToPath(model.uri.toString())
      const lspRange = {
        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
      }

      // 转换诊断信息
      const diagnostics = context.markers.map(marker => ({
        range: {
          start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
          end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
        },
        message: marker.message,
        severity: marker.severity,
        code: marker.code,
        source: marker.source,
      }))

      const result = await getCodeActions(filePath, lspRange, diagnostics)

      if (!result || result.length === 0) {
        return { actions: [], dispose: () => {} }
      }

      const actions: Monaco.languages.CodeAction[] = result.map((action: any) => ({
        title: action.title,
        kind: action.kind,
        diagnostics: action.diagnostics?.map((d: any) => ({
          ...d,
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
        })),
        isPreferred: action.isPreferred,
        edit: action.edit ? convertWorkspaceEdit(monaco, action.edit) : undefined,
      }))

      return { actions, dispose: () => {} }
    },
  })

  // 文档格式化提供者
  monaco.languages.registerDocumentFormattingEditProvider(languages, {
    provideDocumentFormattingEdits: async (model, options) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await formatDocument(filePath, {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      })

      if (!result) return []

      return result.map((edit: any) => ({
        range: {
          startLineNumber: edit.range.start.line + 1,
          startColumn: edit.range.start.character + 1,
          endLineNumber: edit.range.end.line + 1,
          endColumn: edit.range.end.character + 1,
        },
        text: edit.newText,
      }))
    },
  })

  // 选区格式化提供者
  monaco.languages.registerDocumentRangeFormattingEditProvider(languages, {
    provideDocumentRangeFormattingEdits: async (model, range, options) => {
      const filePath = lspUriToPath(model.uri.toString())
      const lspRange = {
        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
      }

      const result = await formatRange(filePath, lspRange, {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      })

      if (!result) return []

      return result.map((edit: any) => ({
        range: {
          startLineNumber: edit.range.start.line + 1,
          startColumn: edit.range.start.character + 1,
          endLineNumber: edit.range.end.line + 1,
          endColumn: edit.range.end.character + 1,
        },
        text: edit.newText,
      }))
    },
  })

  // 重命名提供者
  monaco.languages.registerRenameProvider(languages, {
    provideRenameEdits: async (model, position, newName) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await renameSymbol(
        filePath,
        position.lineNumber - 1,
        position.column - 1,
        newName
      )

      if (!result) return null

      return convertWorkspaceEdit(monaco, result)
    },
    resolveRenameLocation: async (model, position) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await prepareRename(
        filePath,
        position.lineNumber - 1,
        position.column - 1
      )

      if (!result) return null

      return {
        range: {
          startLineNumber: result.range.start.line + 1,
          startColumn: result.range.start.character + 1,
          endLineNumber: result.range.end.line + 1,
          endColumn: result.range.end.character + 1,
        },
        text: result.placeholder,
      }
    },
  })

  // 文档符号提供者（大纲）
  monaco.languages.registerDocumentSymbolProvider(languages, {
    provideDocumentSymbols: async (model) => {
      const filePath = lspUriToPath(model.uri.toString())
      const result = await getDocumentSymbols(filePath)

      if (!result || result.length === 0) return []

      const convertSymbol = (symbol: any): Monaco.languages.DocumentSymbol => ({
        name: symbol.name,
        detail: symbol.detail || '',
        kind: symbolKindMap[symbol.kind] ?? 0,
        range: {
          startLineNumber: symbol.range.start.line + 1,
          startColumn: symbol.range.start.character + 1,
          endLineNumber: symbol.range.end.line + 1,
          endColumn: symbol.range.end.character + 1,
        },
        selectionRange: {
          startLineNumber: symbol.selectionRange.start.line + 1,
          startColumn: symbol.selectionRange.start.character + 1,
          endLineNumber: symbol.selectionRange.end.line + 1,
          endColumn: symbol.selectionRange.end.character + 1,
        },
        tags: [],
        children: symbol.children?.map(convertSymbol) || [],
      })

      return result.map(convertSymbol)
    },
  })

  // Inlay Hints 提供者（类型提示、参数名提示等）
  monaco.languages.registerInlayHintsProvider(languages, {
    provideInlayHints: async (model, range) => {
      const filePath = lspUriToPath(model.uri.toString())
      const lspRange = {
        start: { line: range.startLineNumber - 1, character: 0 },
        end: { line: range.endLineNumber - 1, character: 0 },
      }

      const result = await getInlayHints(filePath, lspRange)

      if (!result || result.length === 0) {
        return { hints: [], dispose: () => {} }
      }

      const hints: Monaco.languages.InlayHint[] = result.map((hint: any) => ({
        label: typeof hint.label === 'string' ? hint.label : hint.label.map((p: any) => p.value).join(''),
        position: {
          lineNumber: hint.position.line + 1,
          column: hint.position.character + 1,
        },
        kind: hint.kind === 1 ? monaco.languages.InlayHintKind.Type : monaco.languages.InlayHintKind.Parameter,
        paddingLeft: hint.paddingLeft,
        paddingRight: hint.paddingRight,
      }))

      return { hints, dispose: () => {} }
    },
  })

  logger.lsp.info('[LSP Providers] All providers registered')
}

/**
 * 转换 LSP WorkspaceEdit 到 Monaco WorkspaceEdit
 */
function convertWorkspaceEdit(
  monaco: typeof Monaco,
  edit: LspWorkspaceEdit
): Monaco.languages.WorkspaceEdit {
  const edits: Monaco.languages.IWorkspaceTextEdit[] = []

  if (edit.changes) {
    Object.entries(edit.changes).forEach(([uri, textEdits]) => {
      textEdits.forEach((textEdit) => {
        edits.push({
          resource: monaco.Uri.parse(uri),
          textEdit: {
            range: {
              startLineNumber: textEdit.range.start.line + 1,
              startColumn: textEdit.range.start.character + 1,
              endLineNumber: textEdit.range.end.line + 1,
              endColumn: textEdit.range.end.character + 1,
            },
            text: textEdit.newText,
          },
          versionId: undefined,
        })
      })
    })
  }

  if (edit.documentChanges) {
    edit.documentChanges.forEach((change: any) => {
      if (change.edits) {
        change.edits.forEach((textEdit: any) => {
          edits.push({
            resource: monaco.Uri.parse(change.textDocument.uri),
            textEdit: {
              range: {
                startLineNumber: textEdit.range.start.line + 1,
                startColumn: textEdit.range.start.character + 1,
                endLineNumber: textEdit.range.end.line + 1,
                endColumn: textEdit.range.end.character + 1,
              },
              text: textEdit.newText,
            },
            versionId: change.textDocument.version,
          })
        })
      }
    })
  }

  return { edits }
}
