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
import { memoryService } from '../services/memoryService'
import { useStore } from '@/renderer/store'
import { composerService } from '../services/composerService'
import { toRelativePath } from '@shared/utils/pathUtils'
import { isLongRunningCommand } from './commandRuntime'
import { internalWriteTracker } from '@/renderer/services/internalWriteTracker'

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

const rawToolExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {
    async read_file(args, ctx) {
        // 支持单个文件或多个文件
        let pathArg = args.path

        // 鲁棒性增强：如果 path 是字符串形式的 JSON 数组（某些模型会这样做），尝试解析它
        if (typeof pathArg === 'string' && pathArg.trim().startsWith('[') && pathArg.trim().endsWith(']')) {
            try {
                const parsed = JSON.parse(pathArg)
                if (Array.isArray(parsed)) {
                    pathArg = parsed
                }
            } catch (e) {
                // 如果解析失败，保留原样，由 resolvePath 处理
            }
        }

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
                            let graphContent = ''
                            try {
                                const nodes = await api.index.parseCallGraph(validPath, content)
                                if (nodes && nodes.length > 0) {
                                    graphContent = '\n--- AST Call Graph Summary ---\n'
                                    const defs: any[] = nodes.filter(n => n.type === 'definition')
                                    const calls: any[] = nodes.filter(n => n.type === 'call')
                                    for (const def of defs) {
                                        const relatedCalls = calls.filter(c => c.callerName === def.name).map(c => c.name)
                                        const callStr = relatedCalls.length > 0 ? ` (calls: ${Array.from(new Set(relatedCalls)).join(', ')})` : ''
                                        graphContent += `- func ${def.name}() [Line ${def.startLine}-${def.endLine}]${callStr}\n`
                                    }
                                }
                            } catch (e) { }
                            return `\n--- File: ${p} ---\n${content}\n${graphContent}\n`
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

        let graphContent = ''
        try {
            const nodes = await api.index.parseCallGraph(path, content)
            if (nodes && nodes.length > 0) {
                graphContent = '\n\n--- AST Call Graph Summary ---\n'
                const defs: any[] = nodes.filter(n => n.type === 'definition')
                const calls: any[] = nodes.filter(n => n.type === 'call')
                for (const def of defs) {
                    const relatedCalls = calls.filter(c => c.callerName === def.name).map(c => c.name)
                    const callStr = relatedCalls.length > 0 ? ` (calls: ${Array.from(new Set(relatedCalls)).join(', ')})` : ''
                    graphContent += `- func ${def.name}() [Line ${def.startLine}-${def.endLine}]${callStr}\n`
                }
            }
        } catch (e) { }

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

        return { success: true, result: numberedContent + graphContent, meta: { filePath: path } }
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
            const searchRegex = isRegex ? new RegExp(pattern, 'gi') : null

            content.split('\n').forEach((line, index) => {
                let matched: boolean
                if (searchRegex) {
                    searchRegex.lastIndex = 0
                    matched = searchRegex.test(line)
                } else {
                    matched = line.toLowerCase().includes(pattern.toLowerCase())
                }
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

        // 判断使用哪种模式：content 单独存在时不触发 line mode（保持与 validate 逻辑一致）
        const hasBatchMode = !!(args.edits && Array.isArray(args.edits))
        const hasLineMode = !!(args.start_line !== undefined || args.end_line !== undefined)

        // 🎯 Fast-Edit 精华：批量编辑模式
        if (hasBatchMode) {
            const edits = args.edits as Array<{
                action: 'replace' | 'insert' | 'delete'
                start_line?: number
                end_line?: number
                after_line?: number
                content?: string
            }>

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            let lines = originalContent.split('\n')

            // 🎯 关键优化：从后往前排序，避免行号偏移
            const sortedEdits = [...edits].sort((a, b) => {
                const aLine = a.start_line || a.after_line || 0
                const bLine = b.start_line || b.after_line || 0
                return bLine - aLine
            })

            // 🎯 检测重叠编辑
            const getEditRange = (edit: typeof edits[0]): [number, number] => {
                if (edit.action === 'replace' || edit.action === 'delete') {
                    return [edit.start_line!, edit.end_line!]
                } else if (edit.action === 'insert') {
                    return [edit.after_line!, edit.after_line!]
                }
                return [0, 0]
            }

            const ranges: Array<[number, number, number, string]> = []
            sortedEdits.forEach((edit, idx) => {
                const [start, end] = getEditRange(edit)
                if (start > 0) {
                    ranges.push([start, end, idx, edit.action])
                }
            })

            ranges.sort((a, b) => a[0] - b[0])

            for (let i = 0; i < ranges.length - 1; i++) {
                const [s1, e1, , act1] = ranges[i]
                const [s2, e2, , act2] = ranges[i + 1]

                if (act1 === 'insert' && act2 === 'insert') continue

                if (s2 <= e1) {
                    return {
                        success: false,
                        result: '',
                        error: `Overlapping edits detected: ${act1} [${s1}-${e1}] overlaps with ${act2} [${s2}-${e2}]. Split into separate calls or adjust line ranges.`
                    }
                }
            }

            const allWarnings: any[] = []
            let linesAdded = 0
            let linesRemoved = 0

            // 应用所有编辑
            for (const edit of sortedEdits) {
                if (edit.action === 'replace') {
                    const { start_line, end_line, content } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const oldLines = lines.slice(start_line! - 1, end_line)
                    const newLines = content!.split('\n')

                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...newLines,
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += oldLines.length
                    linesAdded += newLines.length

                    // 检测警告
                    const { checkLineReplaceWarnings } = await import('../../utils/smartReplace')
                    const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, start_line!, end_line!)
                    allWarnings.push(...warnings)

                } else if (edit.action === 'insert') {
                    const { after_line, content } = edit

                    if (after_line! < 0 || after_line! > lines.length) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid after_line: ${after_line}. File has ${lines.length} lines.`
                        }
                    }

                    const newLines = content!.split('\n')
                    lines = [
                        ...lines.slice(0, after_line),
                        ...newLines,
                        ...lines.slice(after_line)
                    ]

                    linesAdded += newLines.length

                } else if (edit.action === 'delete') {
                    const { start_line, end_line } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const removed = end_line! - start_line! + 1
                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += removed
                }
            }

            const newContent = lines.join('\n')
            internalWriteTracker.mark(path)
            const success = await api.file.write(path, newContent)
            if (!success) return { success: false, result: '', error: 'Failed to write file' }

            fileCacheService.markFileAsRead(path, newContent)

            // 🎯 集成行内预览：将变更记录到 composerService
            composerService.ensureSession()
            composerService.addChange({
                filePath: path,
                relativePath: toRelativePath(path, ctx.workspacePath || ''),
                oldContent: originalContent,
                newContent: newContent,
                changeType: 'modify',
                linesAdded,
                linesRemoved,
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path)

            if (allWarnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${allWarnings.length} potential issues in batch`, allWarnings)
            }

            const result: any = {
                success: true,
                result: `File updated successfully (batch mode: ${edits.length} edits applied)`,
                meta: {
                    filePath: path,
                    oldContent: originalContent,
                    newContent,
                    linesAdded,
                    linesRemoved,
                    totalLines: lines.length,
                    editsApplied: edits.length
                }
            }

            if (allWarnings.length > 0) {
                result.meta.warnings = allWarnings
                result.result += ` (${allWarnings.length} warning${allWarnings.length > 1 ? 's' : ''} detected)`
            }

            return result
        }

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
                internalWriteTracker.mark(path)
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

            // 提取被替换的行（用于警告检测）
            const oldLines = lines.slice(startLine - 1, endLine)
            const newLines = content.split('\n')

            // 执行替换
            lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
            const newContent = lines.join('\n')

            // 🎯 Fast-Edit 精华：智能警告检测
            const { checkLineReplaceWarnings } = await import('../../utils/smartReplace')
            const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, startLine, endLine)

            if (warnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${warnings.length} potential issues`, warnings)
            }

            internalWriteTracker.mark(path)
            const success = await api.file.write(path, newContent)
            if (!success) return { success: false, result: '', error: 'Failed to write file' }

            fileCacheService.markFileAsRead(path, newContent)

            // 🎯 集成行内预览
            const lineChanges = calculateLineChanges(originalContent, newContent)
            composerService.ensureSession()
            composerService.addChange({
                filePath: path,
                relativePath: toRelativePath(path, ctx.workspacePath || ''),
                oldContent: originalContent,
                newContent: newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path)

            const result: any = {
                success: true,
                result: 'File updated successfully (line mode)',
                meta: {
                    filePath: path,
                    oldContent: originalContent,
                    newContent,
                    linesAdded: lineChanges.added,
                    linesRemoved: lineChanges.removed
                }
            }

            // 如果有警告，添加到结果中
            if (warnings.length > 0) {
                result.meta.warnings = warnings
                result.result += ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''} detected)`
            }

            return result
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
            internalWriteTracker.mark(path)
            const writeSuccess = await api.file.write(path, newContent)
            if (!writeSuccess) return { success: false, result: '', error: 'Failed to write file' }

            fileCacheService.markFileAsRead(path, newContent)

            // 🎯 集成行内预览
            const lineChanges = calculateLineChanges(originalContent, newContent)
            composerService.ensureSession()
            composerService.addChange({
                filePath: path,
                relativePath: toRelativePath(path, ctx.workspacePath || ''),
                oldContent: originalContent,
                newContent: newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path)

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
        internalWriteTracker.mark(path)
        const success = await api.file.write(path, content)
        if (!success) return { success: false, result: '', error: 'Failed to write file' }

        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path)

        const lineChanges = calculateLineChanges(originalContent, content)

        // 🎯 集成行内预览
        composerService.ensureSession()
        composerService.addChange({
            filePath: path,
            relativePath: toRelativePath(path, ctx.workspacePath || ''),
            oldContent: originalContent,
            newContent: content,
            changeType: originalContent ? 'modify' : 'create',
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
            toolCallId: ctx.toolCallId
        })
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
        internalWriteTracker.mark(path)
        const success = await api.file.write(path, content)

        if (success) {
            // 通知 LSP 并等待诊断
            await notifyLspAfterWrite(path)

            // 🎯 集成行内预览
            composerService.ensureSession()
            composerService.addChange({
                filePath: path,
                relativePath: toRelativePath(path, ctx.workspacePath || ''),
                oldContent: null,
                newContent: content,
                changeType: 'create',
                linesAdded: content.split('\n').length,
                linesRemoved: 0,
                toolCallId: ctx.toolCallId
            })
        }

        return { success, result: success ? 'File created' : 'Failed to create file', meta: { filePath: path, isNewFile: true, newContent: content, linesAdded: content.split('\n').length } }
    },

    async delete_file_or_folder(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const success = await api.file.delete(path)
        if (success) {
            composerService.ensureSession()
            composerService.addChange({
                filePath: path,
                relativePath: toRelativePath(path, ctx.workspacePath || ''),
                oldContent: null,
                newContent: null,
                changeType: 'delete',
                linesAdded: 0,
                linesRemoved: 0,
            })
        }
        return { success, result: success ? 'Deleted successfully' : 'Failed to delete' }
    },

    async run_command(args, ctx) {
        const command = args.command as string
        // cwd 解析：若 AI 传了 cwd 参数，解析为绝对路径；否则用工作区根目录
        const resolvedCwd = args.cwd ? resolvePath(args.cwd, ctx.workspacePath, true) : null
        const isBackground = args.is_background as boolean
        const config = getAgentConfig()
        const timeout = args.timeout
            ? (args.timeout as number) * 1000
            : config.toolTimeoutMs

        const isLongRunningProcess = isLongRunningCommand(command, isBackground)

        try {
            const { terminalManager } = await import('@/renderer/services/TerminalManager')

            // 先唤出面板，再创建/获取终端，避免竞态：
            // 若先创建终端，notify() 触发时面板还不可见 → useEffect 销毁刚创建的终端
            useStore.getState().setTerminalVisible(true)

            // 获取或复用 Agent 专属终端（初始 cwd 用工作区根目录，避免反复改变终端目录）
            const termId = await terminalManager.getOrCreateAgentTerminal(
                ctx.workspacePath || '/'
            )

            // 激活 Agent 终端 tab，让用户看到执行过程
            terminalManager.setActiveTerminal(termId)

            // === 长进程：直接写入并立即返回，让用户在终端里跟踪 ===
            if (isLongRunningProcess) {
                // 长进程也需要处理 cwd
                const bgCmd = resolvedCwd
                    ? (/windows/i.test(navigator.userAgent)
                        ? `Push-Location "${resolvedCwd}"; ${command}; Pop-Location`
                        : `(cd "${resolvedCwd}" && ${command})`)
                    : command
                terminalManager.writeToTerminal(termId, `${bgCmd}\r`)
                return {
                    success: true,
                    result: `[Background Process Started]\nCommand: ${command}\nTerminal ID: ${termId}\n\nThe process is running in the Agent terminal panel. Use 'read_terminal_output' with terminal_id="${termId}" to check logs. Use 'send_terminal_input' to send input or Ctrl+C (is_ctrl=true). Use 'stop_terminal' to kill it.`,
                    meta: { command, cwd: resolvedCwd, terminalId: termId, isBackground: true }
                }
            }

            // === 短命令：用 sentinel 机制精确捕获输出，同时用户可见 ===
            // 将 resolvedCwd 传给 executeCommandWithOutput，由其负责临时切换目录
            const { output, exitCode, timedOut } = await terminalManager.executeCommandWithOutput(
                termId,
                command,
                timeout,
                resolvedCwd || undefined,
            )

            const hasOutput = output.trim().length > 0
            let resultText = output

            if (!hasOutput) {
                resultText = exitCode === 0
                    ? 'Command executed successfully (no output)'
                    : `Command exited with code ${exitCode} (no output)`
            }

            if (timedOut) {
                resultText = `[Timed out after ${timeout / 1000}s]\n${output}`
            }

            const isSuccess = exitCode === 0 && !timedOut
            return {
                success: isSuccess,
                result: resultText,
                meta: { command, cwd: resolvedCwd, exitCode, timedOut, terminalId: termId },
                error: isSuccess ? undefined : resultText
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            logger.agent.error('[run_command] Execution failed:', errorMsg)
            return {
                success: false,
                result: `Error: Failed to execute command: ${errorMsg}`,
                error: errorMsg
            }
        }
    },

    async read_terminal_output(args) {
        const terminalId = args.terminal_id as string
        const linesCount = (args.lines as number) || 100

        try {
            const { terminalManager } = await import('@/renderer/services/TerminalManager')
            const lines = terminalManager.getOutputBuffer(terminalId)

            if (!lines || lines.length === 0) {
                return {
                    success: true,
                    result: '[Empty buffer. Either the terminal was closed, invalid, or it has not produced output yet]'
                }
            }

            // 返回清理掉 ANSI 色彩字符的内容以便 AI 解析
            const rawOutput = lines.slice(-linesCount).join('')
            const cleanOutput = rawOutput
                .replace(/\x1b\[[0-9;]*[mGK]/g, '')
                .replace(/\r\n/g, '\n')
                .trim()

            return {
                success: true,
                result: cleanOutput || '[Terminal produced no printable output]',
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to read terminal output: ${errorMsg}`, error: errorMsg }
        }
    },

    async send_terminal_input(args) {
        const terminalId = args.terminal_id as string
        const input = args.input as string
        const isCtrl = args.is_ctrl as boolean

        try {
            const { terminalManager } = await import('@/renderer/services/TerminalManager')

            let dataToSend = input
            if (isCtrl) {
                // 将诸如 'c' 转换为 \x03 (Ctrl+C)
                const charCode = input.toLowerCase().charCodeAt(0)
                if (charCode >= 97 && charCode <= 122) { // 'a' - 'z'
                    dataToSend = String.fromCharCode(charCode - 96)
                }
            }

            terminalManager.writeToTerminal(terminalId, dataToSend)

            return {
                success: true,
                result: `Successfully sent ${isCtrl ? 'Ctrl+' + input.toUpperCase() : 'input'} to terminal ${terminalId}`,
                meta: { terminalId, sentCtrl: isCtrl }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to send terminal input: ${errorMsg}`, error: errorMsg }
        }
    },

    async stop_terminal(args) {
        const terminalId = args.terminal_id as string

        try {
            const { terminalManager } = await import('@/renderer/services/TerminalManager')
            terminalManager.closeTerminal(terminalId)
            return {
                success: true,
                result: `Terminal ${terminalId} stopped and closed successfully.`,
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to stop terminal: ${errorMsg}`, error: errorMsg }
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
        const timeout = (args.timeout as number) || 30
        const result = await api.http.webSearch(args.query as string, args.max_results as number, timeout * 1000)
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
        const multiSelect = (args.multi_select as boolean) || false

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
            internalWriteTracker.mark(mdPath)
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
            internalWriteTracker.mark(jsonPath)
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
                internalWriteTracker.mark(mdPath)
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
                internalWriteTracker.mark(jsonPath)
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

            const { startPlanExecution } = await import('../orchestrator/orchestratorExecutor')

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
                const techStack = (validStacks as readonly string[]).includes(stack) ? stack as import('./uiux').TechStack : 'react'

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
            const uiuxDomain = domain && (validDomains as readonly string[]).includes(domain) ? domain as import('./uiux').UiuxDomain : undefined

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

    async remember(args, _ctx) {
        const content = args.content as string
        if (!content) return { success: false, result: '', error: 'Missing content' }

        try {
            await memoryService.addMemory(content)
            return {
                success: true,
                result: `Successfully remembered: ${content}`,
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to remember: ${toAppError(err).message}`,
            }
        }
    },

    async apply_skill(args, _ctx) {
        const skillName = args.skill_name as string
        if (!skillName) return { success: false, result: '', error: 'Missing skill_name' }

        try {
            const { skillService } = await import('../services/skillService')
            const skill = await skillService.getSkillByName(skillName)
            if (!skill) {
                return {
                    success: false,
                    result: '',
                    error: `Skill "${skillName}" not found. Check available skills in the system prompt.`,
                }
            }

            // skill 安装目录
            const installPath = skill.filePath.replace(/[/\\]SKILL\.md$/i, '')
            const { platform } = await import('@shared/utils/pathUtils')
            const isWin = platform.isWindows
            const normalizedPath = isWin ? installPath.replace(/\//g, '\\') : installPath

            // 扫描 skill 目录下的所有文件，让 AI 知道有哪些脚本可用
            let fileTree = ''
            try {
                const items = await api.file.readDir(installPath)
                if (items && items.length > 0) {
                    const listFiles = async (dir: string, prefix: string): Promise<string[]> => {
                        const entries = await api.file.readDir(dir)
                        if (!entries) return []
                        const lines: string[] = []
                        for (const entry of entries) {
                            if (entry.name === 'SKILL.md' || entry.name.startsWith('.') || entry.name === 'node_modules') continue
                            const entryPath = `${dir}${isWin ? '\\' : '/'}${entry.name}`
                            if (entry.isDirectory) {
                                lines.push(`${prefix}${entry.name}/`)
                                lines.push(...await listFiles(entryPath, prefix + '  '))
                            } else {
                                lines.push(`${prefix}${entry.name}`)
                            }
                        }
                        return lines
                    }
                    const tree = await listFiles(installPath, '  ')
                    if (tree.length > 0) {
                        fileTree = `\n\n## Skill Directory Contents\n\`\`\`\n${normalizedPath}/\n${tree.join('\n')}\n\`\`\``
                    }
                }
            } catch {
                // 扫描失败不影响主流程
            }

            const scriptHint = isWin
                ? `On Windows: use \`node\` for .js, \`python\` for .py, \`cmd /c\` for .bat/.cmd`
                : `Use \`bash\` for .sh, \`node\` for .js, \`python\` for .py`

            const result = [
                `<skill name="${skill.name}" path="${normalizedPath}">`,
                skill.content,
                `</skill>`,
                fileTree,
                ``,
                `## Execution Guidelines`,
                `- **Working Directory (CRITICAL)**: Set \`cwd\` to \`${normalizedPath}\` for ALL shell commands from this skill`,
                `- **Scripts**: If the skill references scripts or commands, execute them from the skill directory. ${scriptHint}`,
                `- **Relative Paths**: All relative paths in the skill instructions are relative to \`${normalizedPath}\``,
            ].join('\n')

            return { success: true, result }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to load skill: ${toAppError(err).message}`,
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

export const toolExecutors = Object.fromEntries(
    Object.entries(rawToolExecutors).map(([name, executor]) => [
        name,
        async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
            // 设置超时时间，对于可能耗时的工具给更长的时间
            const timeoutMs = ['generate_tests', 'run_command', 'edit_file', 'replace_file_content', 'web_search'].includes(name) ? 120000 : 60000

            try {
                return await Promise.race([
                    executor(args, ctx),
                    new Promise<ToolExecutionResult>((_, reject) => {
                        setTimeout(() => reject(new Error(`Tool [${name}] execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
                    })
                ])
            } catch (err) {
                logger.agent.error(`[ToolExecutor] Error executing ${name}:`, err)
                return {
                    success: false,
                    result: '',
                    error: `Tool execution error: ${toAppError(err).message}`
                }
            }
        }
    ])
) as Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>>

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
