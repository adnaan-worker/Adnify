import { logger } from '@shared/utils/Logger'
import * as path from 'path'
import * as fs from 'fs'
import Parser from 'web-tree-sitter'

const LANGUAGE_MAP: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', pyw: 'python',
    go: 'go', rs: 'rust', java: 'java',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    cs: 'c_sharp', rb: 'ruby', php: 'php'
}

// Queries for capturing function definitions and function calls
const QUERIES: Record<string, string> = {
    typescript: `
    (function_declaration name: (identifier) @def.name) @def
    (method_definition name: (property_identifier) @def.name) @def
    (variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def
    (call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call
  `,
    tsx: `
    (function_declaration name: (identifier) @def.name) @def
    (method_definition name: (property_identifier) @def.name) @def
    (variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def
    (call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call
  `,
    javascript: `
    (function_declaration name: (identifier) @def.name) @def
    (method_definition name: (property_identifier) @def.name) @def
    (variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def
    (call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call
  `,
    python: `
    (function_definition name: (identifier) @def.name) @def
    (call function: [(identifier) (attribute attribute: (identifier))] @call.name) @call
  `
}

import type { CodeGraphNode } from '@shared/types'
export type { CodeGraphNode }

export class ASTParser {
    private parser: Parser | null = null
    private languages: Map<string, Parser.Language> = new Map()
    private initialized = false
    private wasmDir: string

    constructor() {
        const potentialPaths = [
            path.join(process.resourcesPath || '', 'tree-sitter'),
            path.join(process.cwd(), 'resources', 'tree-sitter'),
            path.join(__dirname, '..', '..', '..', 'resources', 'tree-sitter'),
        ];
        this.wasmDir = potentialPaths.find(p => fs.existsSync(p)) || potentialPaths[1];
    }

    async init() {
        if (this.initialized) return
        try {
            const parserWasm = path.join(this.wasmDir, 'tree-sitter.wasm')
            await Parser.init({
                locateFile: () => parserWasm
            })
            this.parser = new Parser()
            this.initialized = true
        } catch (e) {
            logger.index.error('[ASTParser] Failed to initialize parser:', e)
        }
    }

    private async loadLanguage(langName: string): Promise<boolean> {
        if (!this.parser) return false
        if (this.languages.has(langName)) return true

        try {
            const wasmPath = path.join(this.wasmDir, `tree-sitter-${langName}.wasm`)
            const lang = await Parser.Language.load(wasmPath)
            this.languages.set(langName, lang)
            return true
        } catch (e) {
            logger.index.error(`[ASTParser] Failed to load language ${langName}:`, e)
            return false
        }
    }

    async parseCallGraph(filePath: string, content: string): Promise<CodeGraphNode[]> {
        if (!this.initialized) await this.init()
        if (!this.parser) return []

        const ext = path.extname(filePath).slice(1).toLowerCase()
        const langName = LANGUAGE_MAP[ext]
        if (!langName) return []

        const loaded = await this.loadLanguage(langName)
        if (!loaded) return []

        const lang = this.languages.get(langName)!
        this.parser.setLanguage(lang)
        const tree = this.parser.parse(content)
        if (!tree) return []

        const queryStr = QUERIES[langName]
        if (!queryStr) {
            tree.delete()
            return []
        }

        try {
            const query = lang.query(queryStr)
            const captures = query.captures(tree.rootNode)

            const nodes: CodeGraphNode[] = []
            const defStack: { name: string, endRow: number }[] = []

            // Identify definitions and calls
            for (const capture of captures) {
                const { node, name } = capture

                // Track current enclosing definition scope
                while (defStack.length > 0 && node.startPosition.row > defStack[defStack.length - 1].endRow) {
                    defStack.pop()
                }

                if (name === 'def' || name === 'def.name') {
                    if (name === 'def.name') continue // We handle name locally if needed, but tree-sitter captures them separately

                    // Find the name capture for this def
                    const nameNode = captures.find(c => c.name === 'def.name' && c.node.parent?.id === node.id || c.node.parent?.parent?.id === node.id)?.node
                    const defName = nameNode ? nameNode.text : 'anonymous'

                    nodes.push({
                        id: `def_${node.startPosition.row}_${defName}`,
                        name: defName,
                        type: 'definition',
                        content: node.text,
                        startLine: node.startPosition.row + 1,
                        endLine: node.endPosition.row + 1
                    })

                    defStack.push({ name: defName, endRow: node.endPosition.row })
                } else if (name === 'call') {
                    const nameNode = captures.find(c => c.name === 'call.name' && c.node.parent?.id === node.id)?.node
                    if (!nameNode) continue

                    // Extract just the actual function name being called if it's a member expression (e.g. obj.method -> method)
                    let calleeName = nameNode.text
                    if (nameNode.type === 'member_expression') {
                        const prop = nameNode.childForFieldName('property')
                        if (prop) calleeName = prop.text
                    }

                    const callerName = defStack.length > 0 ? defStack[defStack.length - 1].name : 'global'

                    nodes.push({
                        id: `call_${node.startPosition.row}_${calleeName}`,
                        name: calleeName,
                        type: 'call',
                        content: node.text,
                        startLine: node.startPosition.row + 1,
                        endLine: node.endPosition.row + 1,
                        callerName,
                        calleeName
                    })
                }
            }

            return nodes
        } catch (e) {
            logger.index.error(`[ASTParser] Error querying ${filePath}:`, e)
            return []
        } finally {
            tree.delete()
        }
    }
}
