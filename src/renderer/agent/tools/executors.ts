/**
 * 工具执行器实现
 * 所有内置工具的执行逻辑
 */

import { api } from '@/renderer/services/electronAPI'
import { toAppError } from '@shared/utils/errorHandler'
import { logger } from '@utils/Logger'
import type { ToolExecutionResult, ToolExecutionContext } from '@/shared/types'
import { validatePath, isSensitivePath } from '@shared/utils/pathUtils'
import { pathToLspUri, waitForDiagnostics, isLanguageSupported, getLanguageId } from '@/renderer/services/lspService'
import {
    calculateLineChanges,
} from '@/renderer/utils/searchReplace'
import { smartReplace, normalizeLineEndings } from '@/renderer/utils/smartReplace'
import { getAgentConfig } from '../utils/AgentConfig'
import { fileCacheService } from '../services/fileCacheService'
import { lintService } from '../services/lintService'
import { useStore } from '@/renderer/store'

// ===== 辅助函数 =====

/**
 * 文件写入后通知 LSP 并等待诊断
 * 用于在 Agent 修改文件后获取最新的诊断信息
 */
async function notifyLspAfterWrite(filePath: string): Promise<void> {
    const languageId = getLanguageId(filePath)
    if (!isLanguageSupported(languageId)) return

    try {
        // 等待 LSP 返回诊断信息（最多等待 3 秒）
        await waitForDiagnostics(filePath)
    } catch {
        // 忽略错误，不影响主流程
    }
}

interface DirTreeNode {
    name: string
    path: string
    isDirectory: boolean
    children?: DirTreeNode[]
}

async function buildDirTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<DirTreeNode[]> {
    if (currentDepth >= maxDepth) return []

    const items = await api.file.readDir(dirPath)
    if (!items) return []

    const ignoreDirs = getAgentConfig().ignoredDirectories

    const nodes: DirTreeNode[] = []
    for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.env') continue
        if (ignoreDirs.includes(item.name)) continue

        const node: DirTreeNode = { name: item.name, path: item.path, isDirectory: item.isDirectory }
        if (item.isDirectory && currentDepth < maxDepth - 1) {
            node.children = await buildDirTree(item.path, maxDepth, currentDepth + 1)
        }
        nodes.push(node)
    }

    return nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
    })
}

function formatDirTree(nodes: DirTreeNode[], prefix = ''): string {
    let result = ''
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const isLast = i === nodes.length - 1
        result += `${prefix}${isLast ? '└── ' : '├── '}${node.isDirectory ? '📁 ' : '📄 '}${node.name}\n`
        if (node.children?.length) {
            result += formatDirTree(node.children, prefix + (isLast ? '    ' : '│   '))
        }
    }
    return result
}

function resolvePath(p: unknown, workspacePath: string | null, allowRead = false): string {
    if (typeof p !== 'string') throw new Error('Invalid path: not a string')
    const validation = validatePath(p, workspacePath, { allowSensitive: false, allowOutsideWorkspace: false })
    if (!validation.valid) throw new Error(`Security: ${validation.error}`)
    if (!allowRead && isSensitivePath(validation.sanitizedPath!)) {
        throw new Error('Security: Cannot modify sensitive files')
    }
    return validation.sanitizedPath!
}

// ===== 工具执行器 =====

export const toolExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {
    async read_file(args, ctx) {
        // 支持单个文件或多个文件
        const pathArg = args.path
        const paths = Array.isArray(pathArg) ? pathArg : [pathArg as string]
        
        // 如果是多个文件，使用并行读取
        if (paths.length > 1) {
            const pLimit = (await import('p-limit')).default
            const limit = pLimit(5)

            const results = await Promise.all(
                paths.map(p => limit(async () => {
                    try {
                        const validPath = resolvePath(p, ctx.workspacePath, true)
                        const content = await api.file.read(validPath)
                        if (content !== null) {
                            fileCacheService.markFileAsRead(validPath, content)
                            return `\n--- File: ${p} ---\n${content}\n`
                        }
                        return `\n--- File: ${p} ---\n[File not found]\n`
                    } catch (e: unknown) {
                        return `\n--- File: ${p} ---\n[Error: ${(e as Error).message}]\n`
                    }
                }))
            )

            return { success: true, result: results.join('') }
        }

        // 单个文件读取（原有逻辑）
        const path = resolvePath(paths[0], ctx.workspacePath, true)
        const content = await api.file.read(path)
        if (content === null) return { success: false, result: '', error: `File not found: ${path}` }

        fileCacheService.markFileAsRead(path, content)

        const lines = content.split('\n')
        const startLine = typeof args.start_line === 'number' ? Math.max(1, args.start_line) : 1
        const endLine = typeof args.end_line === 'number' ? Math.min(lines.length, args.end_line) : lines.length
        let numberedContent = lines.slice(startLine - 1, endLine).map((line, i) => `${startLine + i}: ${line}`).join('\n')

        // 使用 maxSingleFileChars 限制单个文件的输出大小
        const config = getAgentConfig()
        if (numberedContent.length > config.maxSingleFileChars) {
            const totalLines = lines.length
            const readLines = endLine - startLine + 1
            numberedContent = numberedContent.slice(0, config.maxSingleFileChars) +
                `\n\n⚠️ FILE TRUNCATED (showing ${readLines} of ${totalLines} lines, ~${config.maxSingleFileChars} chars)\n` +
                `To read more: use search_files to find target location, then read_file with start_line/end_line`
        }

        return { success: true, result: numberedContent, meta: { filePath: path } }
    },

    async list_directory(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const recursive = args.recursive as boolean | undefined
        const maxDepth = (args.max_depth as number) || 3

        if (recursive) {
            // 递归模式（原 get_dir_tree）
            const tree = await buildDirTree(path, maxDepth)
            const result = formatDirTree(tree)
            logger.agent.info(`[list_directory] Recursive: Path: ${path}, Tree nodes: ${tree.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory tree' }
        } else {
            // 非递归模式（原 list_directory）
            const items = await api.file.readDir(path)
            if (!items) return { success: false, result: '', error: `Directory not found: ${path}` }
            const result = items.map(item => `${item.isDirectory ? '📁' : '📄'} ${item.name}`).join('\n')
            logger.agent.info(`[list_directory] Non-recursive: Path: ${path}, Items: ${items.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory' }
        }
    },

    async search_files(args, ctx) {
        const pathArg = args.path as string
        const resolvedPath = resolvePath(pathArg, ctx.workspacePath, true)
        const pattern = args.pattern as string
        // 自动启用 regex 模式（如果包含 | 符号）
        const isRegex = !!args.is_regex || pattern.includes('|')

        // 判断是文件还是目录：尝试读取目录内容，如果失败则认为是文件
        const dirItems = await api.file.readDir(resolvedPath)
        const isDirectory = dirItems !== null

        if (!isDirectory) {
            // 单文件搜索模式（替代原 search_in_file）
            const content = await api.file.read(resolvedPath)
            if (content === null) return { success: false, result: '', error: `File not found: ${resolvedPath}` }

            // 验证正则表达式
            if (isRegex) {
                try {
                    new RegExp(pattern)
                } catch (e) {
                    return { success: false, result: '', error: `Invalid regular expression: ${(e as Error).message}` }
                }
            }

            const matches: string[] = []

            content.split('\n').forEach((line, index) => {
                const matched = isRegex
                    ? new RegExp(pattern, 'gi').test(line)
                    : line.toLowerCase().includes(pattern.toLowerCase())
                if (matched) matches.push(`${pathArg}:${index + 1}: ${line.trim()}`)
            })

            return {
                success: true,
                result: matches.length
                    ? `Found ${matches.length} matches:\n${matches.slice(0, 100).join('\n')}`
                    : `No matches found for "${pattern}"`
            }
        }

        // 目录搜索模式（原有逻辑）
        const results = await api.file.search(pattern, resolvedPath, {
            isRegex,
            include: args.file_pattern as string | undefined,
            isCaseSensitive: false
        })
        if (!results) return { success: false, result: '', error: 'Search failed' }
        return { success: true, result: results.slice(0, 50).map(r => `${r.path}:${r.line}: ${r.text.trim()}`).join('\n') || 'No matches found' }
    },

    async edit_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const originalContent = await api.file.read(path)
        if (originalContent === null) return { success: false, result: '', error: `File not found: ${path}. Use write_file to create new files.` }

        // 判断使用哪种模式
        const hasStringMode = args.old_string || args.new_string
        const hasLineMode = args.start_line || args.end_line || args.content

        if (hasLineMode) {
            // 行模式（原 replace_file_content）
            const startLine = args.start_line as number
            const endLine = args.end_line as number
            const content = args.content as string

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            if (originalContent === '') {
                const success = await api.file.write(path, content)
                if (success) fileCacheService.markFileAsRead(path, content)
                return success
                    ? { success: true, result: 'File written (was empty)', meta: { filePath: path, oldContent: '', newContent: content, linesAdded: content.split('\n').length, linesRemoved: 0 } }
                    : { success: false, result: '', error: 'Failed to write file' }
            }

            const lines = originalContent.split('\n')

            // 验证行号范围
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
                return {
                    success: false,
                    result: '',
                    error: `Invalid line range: ${startLine}-${endLine}. File has ${lines.length} lines. Use read_file to verify line numbers.`
                }
            }

            lines.splice(startLine - 1, endLine - startLine + 1, ...content.split('\n'))
            const newContent = lines.join('\n')

            const success = await api.file.write(path, newContent)
            if (!success) return { success: false, result: '', error: 'Failed to write file' }

            fileCacheService.markFileAsRead(path, newContent)
            await notifyLspAfterWrite(path)

            const lineChanges = calculateLineChanges(originalContent, newContent)
            return { success: true, result: 'File updated successfully (line mode)', meta: { filePath: path, oldContent: originalContent, newContent, linesAdded: lineChanges.added, linesRemoved: lineChanges.removed } }
        } else {
            // 字符串模式（原 edit_file）
            const oldString = args.old_string as string
            const newString = args.new_string as string
            const replaceAll = args.replace_all as boolean | undefined

            const normalizedContent = normalizeLineEndings(originalContent)
            const normalizedOld = normalizeLineEndings(oldString)
            const normalizedNew = normalizeLineEndings(newString)

            const result = smartReplace(normalizedContent, normalizedOld, normalizedNew, replaceAll)

            if (!result.success) {
                const { findSimilarContent, analyzeEditError, generateFixSuggestion } = await import('../utils/EditRetryStrategy')

                const errorType = analyzeEditError(result.error || '')
                const hasCache = fileCacheService.hasValidCache(path)

                const similar = findSimilarContent(normalizedContent, normalizedOld)

                const suggestion = generateFixSuggestion(errorType, {
                    path,
                    oldString: normalizedOld,
                    similarContent: similar.similarText,
                    lineNumber: similar.lineNumber,
                })

                let errorMsg = result.error || 'Replace failed'

                if (similar.found) {
                    errorMsg += `\n\n📍 Similar content found at line ${similar.lineNumber} (${Math.round((similar.similarity || 0) * 100)}% match)`
                }

                if (!hasCache) {
                    errorMsg += '\n\n⚠️ File was not read before editing. Always use read_file first.'
                }

                errorMsg += `\n\n💡 Suggestion: ${suggestion}`

                return { success: false, result: '', error: errorMsg }
            }

            const newContent = result.newContent!
            const writeSuccess = await api.file.write(path, newContent)
            if (!writeSuccess) return { success: false, result: '', error: 'Failed to write file' }

            fileCacheService.markFileAsRead(path, newContent)
            await notifyLspAfterWrite(path)

            const lineChanges = calculateLineChanges(originalContent, newContent)

            const strategyInfo = result.strategy !== 'exact' ? ` (matched via ${result.strategy} strategy)` : ''

            return {
                success: true,
                result: `File updated successfully${strategyInfo}`,
                meta: {
                    filePath: path,
                    oldContent: originalContent,
                    newContent,
                    linesAdded: lineChanges.added,
                    linesRemoved: lineChanges.removed,
                    matchStrategy: result.strategy
                }
            }
        }
    },

    async write_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const content = args.content as string
        const originalContent = await api.file.read(path) || ''
        const success = await api.file.write(path, content)
        if (!success) return { success: false, result: '', error: 'Failed to write file' }

        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path)

        const lineChanges = calculateLineChanges(originalContent, content)
        return { success: true, result: 'File written successfully', meta: { filePath: path, oldContent: originalContent, newContent: content, linesAdded: lineChanges.added, linesRemoved: lineChanges.removed } }
    },

    async create_file_or_folder(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const isFolder = path.endsWith('/') || path.endsWith('\\')

        if (isFolder) {
            const success = await api.file.mkdir(path)
            return { success, result: success ? 'Folder created' : 'Failed to create folder' }
        }

        const content = (args.content as string) || ''
        const success = await api.file.write(path, content)

        if (success) {
            // 通知 LSP 并等待诊断
            await notifyLspAfterWrite(path)
        }

        return { success, result: success ? 'File created' : 'Failed to create file', meta: { filePath: path, isNewFile: true, newContent: content, linesAdded: content.split('\n').length } }
    },

    async delete_file_or_folder(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const success = await api.file.delete(path)
        return { success, result: success ? 'Deleted successfully' : 'Failed to delete' }
    },

    async run_command(args, ctx) {
        const command = args.command as string
        const cwd = args.cwd ? resolvePath(args.cwd, ctx.workspacePath, true) : ctx.workspacePath
        // 从配置获取超时时间，args.timeout 可以覆盖
        const config = getAgentConfig()
        const timeout = args.timeout
            ? (args.timeout as number) * 1000
            : config.toolTimeoutMs

        try {
            // 使用后台执行（不依赖 PTY，更可靠）
            const result = await api.shell.executeBackground({
                command,
                cwd: cwd || ctx.workspacePath || undefined,
                timeout,
            })

            // 构建结果信息
            const output = result.output || ''
            const hasOutput = output.trim().length > 0

            let resultText = output
            if (result.error) {
                resultText = hasOutput
                    ? `${output}\n\n[Error: ${result.error}]`
                    : `Error: ${result.error}`
            } else if (!hasOutput) {
                resultText = result.exitCode === 0 ? 'Command executed successfully (no output)' : `Command exited with code ${result.exitCode} (no output)`
            }

            // 判断成功：
            // 1. 退出码为 0 一定是成功
            // 2. 有正常输出且没有明确错误也视为成功（让 AI 判断内容）
            // 3. 超时或执行错误才是失败
            const isSuccess = result.exitCode === 0 || (hasOutput && !result.error)

            return {
                success: isSuccess,
                result: resultText,
                meta: {
                    command,
                    cwd,
                    exitCode: result.exitCode ?? (result.success ? 0 : 1),
                    timedOut: result.error?.includes('timed out')
                },
                error: isSuccess ? undefined : resultText // 设置 error 让 LLM 知道失败了
            }
        } catch (error) {
            // 捕获执行异常（如 IPC 通信失败）
            const errorMsg = error instanceof Error ? error.message : String(error)
            logger.agent.error('[run_command] Execution failed:', errorMsg)

            return {
                success: false,
                result: `Error: Failed to execute command: ${errorMsg}`,
                error: errorMsg
            }
        }
    },

    async get_lint_errors(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const errors = await lintService.getLintErrors(path, args.refresh as boolean)
        return { success: true, result: errors.length ? errors.map((e) => `[${e.severity}] ${e.message} (Line ${e.startLine})`).join('\n') : 'No lint errors found.' }
    },

    async codebase_search(args, ctx) {
        if (!ctx.workspacePath) return { success: false, result: '', error: 'No workspace open' }
        try {
            const results = await api.index.hybridSearch(ctx.workspacePath, args.query as string, (args.top_k as number) || 10)
            if (!results?.length) return { success: true, result: 'No results found' }
            return { success: true, result: results.map((r: { relativePath: string; startLine: number; content: string }) => `${r.relativePath}:${r.startLine}: ${r.content.trim()}`).join('\n') }
        } catch (e) {
            return { success: false, result: '', error: e instanceof Error ? e.message : 'Search failed' }
        }
    },

    async find_references(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const locations = await api.lsp.references({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!locations?.length) return { success: true, result: 'No references found' }

        // 转换 URI 为相对路径
        const formatLocation = (loc: { uri: string; range: { start: { line: number; character: number } } }) => {
            let filePath = loc.uri
            if (filePath.startsWith('file:///')) filePath = filePath.slice(8)
            else if (filePath.startsWith('file://')) filePath = filePath.slice(7)
            try { filePath = decodeURIComponent(filePath) } catch { }
            // 转为相对路径
            if (ctx.workspacePath && filePath.toLowerCase().startsWith(ctx.workspacePath.toLowerCase().replace(/\\/g, '/'))) {
                filePath = filePath.slice(ctx.workspacePath.length).replace(/^[/\\]+/, '')
            }
            return `${filePath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`
        }
        return { success: true, result: locations.map(formatLocation).join('\n') }
    },

    async go_to_definition(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const locations = await api.lsp.definition({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!locations?.length) return { success: true, result: 'Definition not found' }

        // 转换 URI 为相对路径
        const formatLocation = (loc: { uri: string; range: { start: { line: number; character: number } } }) => {
            let filePath = loc.uri
            if (filePath.startsWith('file:///')) filePath = filePath.slice(8)
            else if (filePath.startsWith('file://')) filePath = filePath.slice(7)
            try { filePath = decodeURIComponent(filePath) } catch { }
            // 转为相对路径
            if (ctx.workspacePath && filePath.toLowerCase().startsWith(ctx.workspacePath.toLowerCase().replace(/\\/g, '/'))) {
                filePath = filePath.slice(ctx.workspacePath.length).replace(/^[/\\]+/, '')
            }
            return `${filePath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`
        }
        return { success: true, result: locations.map(formatLocation).join('\n') }
    },

    async get_hover_info(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const hover = await api.lsp.hover({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!hover?.contents) return { success: true, result: 'No hover info' }
        const contents = Array.isArray(hover.contents) ? hover.contents.join('\n') : (typeof hover.contents === 'string' ? hover.contents : hover.contents.value)
        return { success: true, result: contents }
    },

    async get_document_symbols(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const symbols = await api.lsp.documentSymbol({ uri: pathToLspUri(path), workspacePath: ctx.workspacePath })
        if (!symbols?.length) return { success: true, result: 'No symbols found' }

        const format = (s: { name: string; kind: number; children?: unknown[] }, depth: number): string => {
            let out = `${'  '.repeat(depth)}${s.name} (${s.kind})\n`
            if (s.children) out += (s.children as typeof s[]).map((c: typeof s) => format(c, depth + 1)).join('')
            return out
        }
        return { success: true, result: symbols.map((s: { name: string; kind: number; children?: unknown[] }) => format(s, 0)).join('') }
    },

    async web_search(args) {
        const result = await api.http.webSearch(args.query as string, args.max_results as number)
        if (!result.success || !result.results) return { success: false, result: '', error: result.error || 'Search failed' }
        return { success: true, result: result.results.map((r: { title: string; url: string; snippet: string }) => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n') }
    },

    async read_url(args) {
        // timeout 参数单位是秒，转换为毫秒，最小 30 秒，默认 60 秒
        const timeoutSec = Math.max((args.timeout as number) || 60, 30)
        const result = await api.http.readUrl(args.url as string, timeoutSec * 1000)
        if (!result.success || !result.content) return { success: false, result: '', error: result.error || 'Failed to read URL' }
        return { success: true, result: `Title: ${result.title}\n\n${result.content}` }
    },

    async ask_user(args, _ctx) {
        const question = args.question as string
        const rawOptions = args.options as Array<{ id?: string; value?: string; label: string; description?: string }>
        const multiSelect = (args.multiSelect as boolean) || false

        // 兼容处理：支持 id 或 value 作为选项标识符
        const options = rawOptions.map((opt, idx) => ({
            id: opt.id || opt.value || `option-${idx}`,
            label: opt.label,
            description: opt.description,
        }))

        // 返回 interactive 数据，由 loop.ts 负责设置到 store
        return {
            success: true,
            result: `Waiting for user to select from options. Question: "${question}"`,
            meta: {
                waitingForUser: true,
                interactive: { type: 'interactive' as const, question, options, multiSelect },
            },
        }
    },

    async create_task_plan(args, ctx) {
        const name = args.name as string
        const requirementsDoc = args.requirementsDoc as string
        const tasks = args.tasks as Array<{
            title: string
            description: string
            suggestedProvider: string
            suggestedModel: string
            suggestedRole: string
            dependencies?: string[]
        }>
        const executionMode = (args.executionMode as 'sequential' | 'parallel') || 'sequential'

        if (!ctx.workspacePath) {
            return { success: false, result: 'No workspace path available' }
        }

        try {
            // 生成唯一 ID
            const timestamp = Date.now()
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
            const planId = `${slug}-${timestamp}`

            // 创建 .adnify/plan 目录
            const planDir = `${ctx.workspacePath}/.adnify/plan`
            await api.file.mkdir(planDir)

            // 保存需求文档 (markdown)
            const mdPath = `${planDir}/${planId}.md`
            await api.file.write(mdPath, requirementsDoc)

            // 构建任务对象
            // 处理 "default" 值，转换为真实的默认配置
            const resolveDefault = (value: string | undefined, fallback: string) => {
                if (!value || value === 'default' || value === 'Default') return fallback
                return value
            }

            const planTasks = tasks.map((t, idx) => ({
                id: `task-${idx + 1}`,
                title: t.title,
                description: t.description,
                provider: resolveDefault(t.suggestedProvider, 'anthropic'),
                model: resolveDefault(t.suggestedModel, 'claude-sonnet-4-20250514'),
                role: resolveDefault(t.suggestedRole, 'coder'),
                dependencies: t.dependencies || [],
                status: 'pending' as const,
            }))

            // 构建规划对象
            const plan = {
                id: planId,
                name,
                createdAt: timestamp,
                updatedAt: timestamp,
                requirementsDoc: `${planId}.md`,
                executionMode,
                status: 'draft' as const,
                tasks: planTasks,
            }

            // 保存规划文件 (json)
            const jsonPath = `${planDir}/${planId}.json`
            await api.file.write(jsonPath, JSON.stringify(plan, null, 2))

            // 添加到 store 并打开 TaskBoard
            const { useAgentStore } = await import('../store/AgentStore')
            useAgentStore.getState().addPlan(plan)

            // 打开 plan 文件（触发 TaskBoard 渲染）
            useStore.getState().openFile(jsonPath, JSON.stringify(plan, null, 2))

            return {
                success: true,
                result: `Created task plan "${name}" with ${tasks.length} tasks.\nPlan file: ${jsonPath}\nRequirements: ${mdPath}\n\nThe TaskBoard has been opened for user review. Please review the plan and click "开始执行" to proceed.`,
                meta: { planId, planPath: jsonPath, stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async update_task_plan(args, ctx) {
        try {
            const planId = args.planId as string
            const updateRequirements = args.updateRequirements as string | undefined
            const addTasks = args.addTasks as Array<{
                title: string
                description: string
                suggestedProvider?: string
                suggestedModel?: string
                suggestedRole?: string
                insertAfter?: string
            }> | undefined
            const removeTasks = args.removeTasks as string[] | undefined
            const updateTasks = args.updateTasks as Array<{
                taskId: string
                title?: string
                description?: string
                provider?: string
                model?: string
                role?: string
            }> | undefined
            const executionMode = args.executionMode as 'sequential' | 'parallel' | undefined

            const { useAgentStore } = await import('../store/AgentStore')
            const store = useAgentStore.getState()
            const plan = store.plans.find(p => p.id === planId)

            if (!plan) {
                return { success: false, result: `Plan not found: ${planId}` }
            }

            const changes: string[] = []

            // 更新需求文档
            if (updateRequirements) {
                const mdPath = `${ctx.workspacePath}/.adnify/plan/${plan.requirementsDoc}`
                const existingContent = await api.file.read(mdPath)
                const newContent = `${existingContent}\n\n---\n## Updates\n${updateRequirements}`
                await api.file.write(mdPath, newContent)
                changes.push('Updated requirements document')
            }

            // 删除任务
            if (removeTasks?.length) {
                const newTasks = plan.tasks.filter(t => !removeTasks.includes(t.id))
                store.updatePlan(planId, { tasks: newTasks })
                changes.push(`Removed ${removeTasks.length} tasks`)
            }

            // 添加任务
            if (addTasks?.length) {
                const timestamp = Date.now()
                const newTasks = addTasks.map((t, i) => ({
                    id: `task-${timestamp}-${i}`,
                    title: t.title,
                    description: t.description,
                    provider: t.suggestedProvider || 'anthropic',
                    model: t.suggestedModel || 'claude-sonnet-4-20250514',
                    role: t.suggestedRole || 'coder',
                    status: 'pending' as const,
                    dependencies: [],
                }))

                const currentPlan = store.plans.find(p => p.id === planId)
                if (currentPlan) {
                    store.updatePlan(planId, { tasks: [...currentPlan.tasks, ...newTasks] })
                }
                changes.push(`Added ${addTasks.length} tasks`)
            }

            // 更新任务
            if (updateTasks?.length) {
                for (const update of updateTasks) {
                    store.updateTask(planId, update.taskId, {
                        title: update.title,
                        description: update.description,
                        provider: update.provider,
                        model: update.model,
                        role: update.role,
                    })
                }
                changes.push(`Updated ${updateTasks.length} tasks`)
            }

            // 更新执行模式
            if (executionMode) {
                store.updatePlan(planId, { executionMode })
                changes.push(`Changed execution mode to ${executionMode}`)
            }

            // 更新 JSON 文件
            const updatedPlan = store.plans.find(p => p.id === planId)
            if (updatedPlan) {
                const jsonPath = `${ctx.workspacePath}/.adnify/plan/${planId}.json`
                await api.file.write(jsonPath, JSON.stringify(updatedPlan, null, 2))
            }

            return {
                success: true,
                result: `Plan updated:\n${changes.map(c => `- ${c}`).join('\n')}\n\nPlease review the changes in the TaskBoard.`,
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async start_task_execution(args) {
        try {
            const planId = args.planId as string | undefined

            // 验证计划存在且可执行
            const { useAgentStore } = await import('../store/AgentStore')
            const store = useAgentStore.getState()

            const plan = planId
                ? store.plans.find(p => p.id === planId)
                : store.getActivePlan()

            if (!plan) {
                return {
                    success: false,
                    result: 'Error: No task plan found. You must first create a plan using `create_task_plan` before starting execution.\n\nPlease:\n1. Use `ask_user` to gather requirements\n2. Use `create_task_plan` to create a plan\n3. Wait for user to review and approve\n4. Then use `start_task_execution`'
                }
            }

            if (plan.tasks.length === 0) {
                return {
                    success: false,
                    result: 'Error: Plan has no tasks. Use `update_task_plan` to add tasks first.'
                }
            }

            if (plan.status === 'executing') {
                return {
                    success: false,
                    result: 'Error: Plan is already being executed.'
                }
            }

            const { startPlanExecution } = await import('../services/orchestratorExecutor')

            // 异步启动执行（不等待完成）
            const result = await startPlanExecution(plan.id)

            if (!result.success) {
                return { success: false, result: result.message }
            }

            return {
                success: true,
                result: `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.\n\nProgress will be shown in the TaskBoard.`,
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async uiux_search(args) {
        const { uiuxDatabase } = await import('./uiux')

        const query = args.query as string
        const domain = args.domain as string | undefined
        const stack = args.stack as string | undefined
        const maxResults = (args.max_results as number) || 3

        try {
            await uiuxDatabase.initialize()

            // 如果指定了 stack，搜索技术栈指南
            if (stack) {
                // 验证 stack 类型
                const validStacks = ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter'] as const
                const techStack = validStacks.includes(stack as any) ? stack as import('./uiux').TechStack : 'react'

                const result = await uiuxDatabase.searchStack(query, techStack, maxResults)
                if (result.count === 0) {
                    return {
                        success: true,
                        result: `No ${stack} guidelines found for "${query}". Try different keywords.`
                    }
                }
                return {
                    success: true,
                    result: formatUiuxResults(result),
                    richContent: [{
                        type: 'json' as const,
                        text: JSON.stringify(result, null, 2),
                        title: `${stack} Guidelines: ${query}`,
                    }],
                }
            }

            // 否则搜索域数据
            // 验证 domain 类型
            const validDomains = ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt'] as const
            const uiuxDomain = domain && validDomains.includes(domain as any) ? domain as import('./uiux').UiuxDomain : undefined

            const result = await uiuxDatabase.search(query, uiuxDomain, maxResults)
            if (result.count === 0) {
                return {
                    success: true,
                    result: `No ${result.domain} results found for "${query}". Try different keywords or specify a different domain.`
                }
            }

            return {
                success: true,
                result: formatUiuxResults(result),
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: `UI/UX ${result.domain}: ${query}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX search failed: ${toAppError(err).message}`,
            }
        }
    },

    async uiux_recommend(args) {
        const { uiuxDatabase } = await import('./uiux')

        const productType = args.product_type as string

        try {
            await uiuxDatabase.initialize()
            const recommendation = await uiuxDatabase.getRecommendation(productType)

            if (!recommendation.product) {
                return {
                    success: true,
                    result: `No product type found matching "${productType}". Try: saas, e-commerce, fintech, healthcare, gaming, portfolio, etc.`,
                }
            }

            const result = formatRecommendation(productType, recommendation)

            return {
                success: true,
                result,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(recommendation, null, 2),
                    title: `Design Recommendation: ${productType}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX recommendation failed: ${toAppError(err).message}`,
            }
        }
    },

    // ===== AI 辅助工具 =====
    async analyze_code(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const { llmConfig } = useStore.getState()

        try {
            // 读取文件内容
            const code = await api.file.read(path)
            if (code === null) {
                return { success: false, result: '', error: `File not found: ${path}` }
            }

            const language = getLanguageId(path)

            // 调用 AI 分析
            const response = await api.llm.analyzeCode({
                config: llmConfig,
                code,
                language,
                filePath: path,
            })

            const result = response.data

            // 格式化结果
            const issues = result.issues.map(issue =>
                `[${issue.severity}] Line ${issue.line}: ${issue.message}`
            ).join('\n')

            const suggestions = result.suggestions.map((sug, i) =>
                `${i + 1}. [${sug.priority}] ${sug.title}\n   ${sug.description}`
            ).join('\n\n')

            const output = [
                '=== AI Code Analysis ===',
                '',
                '## Issues:',
                issues || 'No issues found',
                '',
                '## Suggestions:',
                suggestions || 'No suggestions',
                '',
                '## Summary:',
                result.summary,
                '',
                response.usage ? `## Token Usage: ${response.usage.totalTokens} tokens (${response.usage.cachedInputTokens || 0} cached)` : '',
            ].join('\n')

            return {
                success: true,
                result: output,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: 'Code Analysis Result',
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Code analysis failed: ${toAppError(err).message}`,
            }
        }
    },

    async suggest_refactoring(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const { llmConfig } = useStore.getState()

        try {
            // 读取文件内容
            const code = await api.file.read(path)
            if (code === null) {
                return { success: false, result: '', error: `File not found: ${path}` }
            }

            const language = getLanguageId(path)

            // 调用 AI 重构建议
            const response = await api.llm.suggestRefactoring({
                config: llmConfig,
                code,
                language,
                intent: args.intent as string,
            })

            const result = response.data

            // 格式化结果
            const refactorings = result.refactorings.map((ref, i) =>
                `${i + 1}. [${ref.confidence}] ${ref.title}\n` +
                `   ${ref.description}\n` +
                `   ${ref.explanation}\n` +
                `   Changes: ${ref.changes.length} modification(s)`
            ).join('\n\n')

            const output = [
                '=== Refactoring Suggestions ===',
                '',
                refactorings,
                '',
                response.usage ? `## Token Usage: ${response.usage.totalTokens} tokens (${response.usage.cachedInputTokens || 0} cached)` : '',
            ].join('\n')

            return {
                success: true,
                result: output,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: 'Refactoring Suggestions',
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Refactoring suggestion failed: ${toAppError(err).message}`,
            }
        }
    },

    async suggest_fixes(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const { llmConfig } = useStore.getState()

        try {
            // 读取文件内容
            const code = await api.file.read(path)
            if (code === null) {
                return { success: false, result: '', error: `File not found: ${path}` }
            }

            const language = getLanguageId(path)

            // 获取诊断信息
            const lintErrors = await lintService.getLintErrors(path, true)
            const diagnostics = lintErrors.map(err => ({
                message: toAppError(err).message,
                line: err.startLine ?? err.line ?? 1,
                column: err.column ?? 1,
                severity: err.severity === 'error' ? 1 : err.severity === 'warning' ? 2 : 3,
            }))

            if (diagnostics.length === 0) {
                return {
                    success: true,
                    result: 'No errors found. File is clean!',
                }
            }

            // 调用 AI 修复建议
            const response = await api.llm.suggestFixes({
                config: llmConfig,
                code,
                language,
                diagnostics,
            })

            const result = response.data

            // 格式化结果
            const fixes = result.fixes.map((fix, i) =>
                `${i + 1}. [${fix.confidence}] ${fix.title}\n` +
                `   Diagnostic #${fix.diagnosticIndex}: ${diagnostics[fix.diagnosticIndex]?.message || 'Unknown'}\n` +
                `   ${fix.description}\n` +
                `   Changes: ${fix.changes.length} modification(s)`
            ).join('\n\n')

            const output = [
                '=== AI Fix Suggestions ===',
                '',
                fixes,
                '',
                response.usage ? `## Token Usage: ${response.usage.totalTokens} tokens (${response.usage.cachedInputTokens || 0} cached)` : '',
            ].join('\n')

            return {
                success: true,
                result: output,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: 'Fix Suggestions',
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Fix suggestion failed: ${toAppError(err).message}`,
            }
        }
    },

    async generate_tests(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const { llmConfig } = useStore.getState()

        try {
            // 读取文件内容
            const code = await api.file.read(path)
            if (code === null) {
                return { success: false, result: '', error: `File not found: ${path}` }
            }

            const language = getLanguageId(path)

            // 调用 AI 测试生成
            const response = await api.llm.generateTests({
                config: llmConfig,
                code,
                language,
                framework: args.framework as string | undefined,
            })

            const result = response.data

            // 格式化结果
            const testCases = result.testCases.map((tc, i) =>
                `${i + 1}. [${tc.type}] ${tc.name}\n` +
                `   ${tc.description}\n` +
                `   \`\`\`${language}\n${tc.code}\n\`\`\``
            ).join('\n\n')

            const output = [
                '=== Generated Tests ===',
                '',
                result.setup ? `## Setup:\n\`\`\`${language}\n${result.setup}\n\`\`\`\n` : '',
                '## Test Cases:',
                testCases,
                '',
                result.teardown ? `## Teardown:\n\`\`\`${language}\n${result.teardown}\n\`\`\`` : '',
                '',
                response.usage ? `## Token Usage: ${response.usage.totalTokens} tokens (${response.usage.cachedInputTokens || 0} cached)` : '',
            ].filter(Boolean).join('\n')

            return {
                success: true,
                result: output,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: 'Generated Tests',
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Test generation failed: ${toAppError(err).message}`,
            }
        }
    },
}


/**
 * 格式化 UI/UX 搜索结果为可读文本
 */
function formatUiuxResults(result: { domain: string; query: string; count: number; results: Record<string, unknown>[]; stack?: string }): string {
    const lines: string[] = []

    if (result.stack) {
        lines.push(`## ${result.stack} Guidelines for "${result.query}"`)
    } else {
        lines.push(`## UI/UX ${result.domain} results for "${result.query}"`)
    }
    lines.push(`Found ${result.count} result(s)\n`)

    for (let i = 0; i < result.results.length; i++) {
        const item = result.results[i]
        lines.push(`### Result ${i + 1}`)

        for (const [key, value] of Object.entries(item)) {
            if (value && String(value).trim()) {
                lines.push(`- **${key}**: ${value}`)
            }
        }
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 格式化设计推荐结果
 */
function formatRecommendation(
    productType: string,
    rec: {
        product: Record<string, unknown> | null
        style: Record<string, unknown> | null
        prompt: Record<string, unknown> | null
        color: Record<string, unknown> | null
        typography: Record<string, unknown> | null
        landing: Record<string, unknown> | null
    }
): string {
    const lines: string[] = []

    lines.push(`# Design Recommendation for "${productType}"`)
    lines.push('')

    // Product Overview
    if (rec.product) {
        lines.push('## Product Analysis')
        lines.push(`- **Type**: ${rec.product['Product Type'] || productType}`)
        lines.push(`- **Recommended Style**: ${rec.product['Primary Style Recommendation'] || 'N/A'}`)
        lines.push(`- **Secondary Styles**: ${rec.product['Secondary Styles'] || 'N/A'}`)
        lines.push(`- **Color Focus**: ${rec.product['Color Palette Focus'] || 'N/A'}`)
        lines.push(`- **Key Considerations**: ${rec.product['Key Considerations'] || 'N/A'}`)
        lines.push('')
    }

    // Style Details
    if (rec.style) {
        lines.push('## UI Style')
        lines.push(`- **Style**: ${rec.style['Style Category'] || 'N/A'}`)
        lines.push(`- **Keywords**: ${rec.style['Keywords'] || 'N/A'}`)
        lines.push(`- **Primary Colors**: ${rec.style['Primary Colors'] || 'N/A'}`)
        lines.push(`- **Effects**: ${rec.style['Effects & Animation'] || 'N/A'}`)
        lines.push(`- **Best For**: ${rec.style['Best For'] || 'N/A'}`)
        lines.push('')
    }

    // CSS/Tailwind Keywords
    if (rec.prompt) {
        lines.push('## Implementation Keywords')
        lines.push(`- **AI Prompt**: ${rec.prompt['AI Prompt Keywords (Copy-Paste Ready)'] || 'N/A'}`)
        lines.push(`- **CSS/Technical**: ${rec.prompt['CSS/Technical Keywords'] || 'N/A'}`)
        lines.push(`- **Design Variables**: ${rec.prompt['Design System Variables'] || 'N/A'}`)
        lines.push('')
    }

    // Color Palette
    if (rec.color) {
        lines.push('## Color Palette')
        lines.push(`- **Product Type**: ${rec.color['Product Type'] || 'N/A'}`)
        lines.push(`- **Primary**: ${rec.color['Primary Color'] || rec.color['Primary Colors'] || 'N/A'}`)
        lines.push(`- **Secondary**: ${rec.color['Secondary Color'] || rec.color['Secondary Colors'] || 'N/A'}`)
        lines.push(`- **Accent**: ${rec.color['Accent Color'] || rec.color['Accent Colors'] || 'N/A'}`)
        lines.push(`- **Background**: ${rec.color['Background'] || 'N/A'}`)
        lines.push('')
    }

    // Typography
    if (rec.typography) {
        lines.push('## Typography')
        lines.push(`- **Pairing**: ${rec.typography['Pairing Name'] || rec.typography['Font Pairing'] || 'N/A'}`)
        lines.push(`- **Heading Font**: ${rec.typography['Heading Font'] || 'N/A'}`)
        lines.push(`- **Body Font**: ${rec.typography['Body Font'] || 'N/A'}`)
        lines.push(`- **Google Fonts**: ${rec.typography['Google Fonts Import'] || 'N/A'}`)
        lines.push(`- **Tailwind Config**: ${rec.typography['Tailwind Config'] || 'N/A'}`)
        lines.push('')
    }

    // Landing Page Pattern
    if (rec.landing) {
        lines.push('## Landing Page Pattern')
        lines.push(`- **Pattern**: ${rec.landing['Pattern Name'] || 'N/A'}`)
        lines.push(`- **Section Order**: ${rec.landing['Section Order'] || 'N/A'}`)
        lines.push(`- **CTA Placement**: ${rec.landing['Primary CTA Placement'] || 'N/A'}`)
        lines.push(`- **Color Strategy**: ${rec.landing['Color Strategy'] || 'N/A'}`)
        lines.push(`- **Effects**: ${rec.landing['Recommended Effects'] || 'N/A'}`)
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 初始化工具注册表
 * 注意：每次调用都会更新 globalExecutors，支持热重载
 */
export async function initializeTools(): Promise<void> {
    const { toolRegistry } = await import('./registry')
    // 每次都调用 registerAll 以更新 globalExecutors（支持热重载）
    // registerAll 内部会更新 globalExecutors 引用
    toolRegistry.registerAll(toolExecutors)
}
