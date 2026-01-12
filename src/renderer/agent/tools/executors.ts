/**
 * 工具执行器实现
 * 所有内置工具的执行逻辑
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { ToolExecutionResult, ToolExecutionContext } from '@/shared/types'
import type { PlanItem, PlanFileData } from '../types'
import { validatePath, isSensitivePath } from '@shared/utils/pathUtils'
import { pathToLspUri, waitForDiagnostics, isLanguageSupported, getLanguageId } from '@/renderer/services/lspService'
import {
    calculateLineChanges,
} from '@/renderer/utils/searchReplace'
import { smartReplace, normalizeLineEndings } from '@/renderer/utils/smartReplace'
import { getAgentConfig } from '../utils/AgentConfig'
import { AgentService } from '../services/AgentService'
import { useAgentStore } from '../store/AgentStore'
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

function generatePlanJson(plan: { items: PlanItem[]; status?: string }, title?: string): PlanFileData {
    const now = Date.now()
    return {
        version: 1,
        title: title || 'Execution Plan',
        status: (plan.status as PlanFileData['status']) || 'draft',
        createdAt: now,
        updatedAt: now,
        items: plan.items.map(item => ({
            id: item.id,
            title: item.title,
            description: item.description,
            status: item.status,
        })),
    }
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
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const content = await api.file.read(path)
        if (content === null) return { success: false, result: '', error: `File not found: ${path}` }

        AgentService.markFileAsRead(path, content)

        const lines = content.split('\n')
        const startLine = typeof args.start_line === 'number' ? Math.max(1, args.start_line) : 1
        const endLine = typeof args.end_line === 'number' ? Math.min(lines.length, args.end_line) : lines.length
        const numberedContent = lines.slice(startLine - 1, endLine).map((line, i) => `${startLine + i}: ${line}`).join('\n')

        return { success: true, result: numberedContent, meta: { filePath: path } }
    },

    async list_directory(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const items = await api.file.readDir(path)
        if (!items) return { success: false, result: '', error: `Directory not found: ${path}` }
        return { success: true, result: items.map(item => `${item.isDirectory ? '📁' : '📄'} ${item.name}`).join('\n') }
    },

    async get_dir_tree(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const tree = await buildDirTree(path, (args.max_depth as number) || 3)
        return { success: true, result: formatDirTree(tree) }
    },

    async search_files(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const results = await api.file.search(args.pattern as string, path, {
            isRegex: !!args.is_regex, include: args.file_pattern as string | undefined, isCaseSensitive: false
        })
        if (!results) return { success: false, result: 'Search failed' }
        return { success: true, result: results.slice(0, 50).map(r => `${r.path}:${r.line}: ${r.text.trim()}`).join('\n') || 'No matches found' }
    },

    async search_in_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const content = await api.file.read(path)
        if (content === null) return { success: false, result: '', error: `File not found: ${path}` }

        const pattern = args.pattern as string
        const matches: string[] = []
        content.split('\n').forEach((line, index) => {
            const matched = args.is_regex
                ? (() => { try { return new RegExp(pattern, 'gi').test(line) } catch { return false } })()
                : line.toLowerCase().includes(pattern.toLowerCase())
            if (matched) matches.push(`${index + 1}: ${line.trim()}`)
        })

        return { success: true, result: matches.length ? `Found ${matches.length} matches:\n${matches.slice(0, 100).join('\n')}` : `No matches found for "${pattern}"` }
    },

    async read_multiple_files(args, ctx) {
        const paths = args.paths as string[]
        const pLimit = (await import('p-limit')).default
        const limit = pLimit(5) // 最多 5 个并发读取

        const results = await Promise.all(
            paths.map(p => limit(async () => {
                try {
                    const validPath = resolvePath(p, ctx.workspacePath, true)
                    const content = await api.file.read(validPath)
                    if (content !== null) {
                        AgentService.markFileAsRead(validPath, content)
                        return `\n--- File: ${p} ---\n${content}\n`
                    }
                    return `\n--- File: ${p} ---\n[File not found]\n`
                } catch (e: unknown) {
                    return `\n--- File: ${p} ---\n[Error: ${(e as Error).message}]\n`
                }
            }))
        )

        return { success: true, result: results.join('') }
    },

    async edit_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const originalContent = await api.file.read(path)
        if (originalContent === null) return { success: false, result: '', error: `File not found: ${path}. Use write_file to create new files.` }

        const oldString = args.old_string as string
        const newString = args.new_string as string
        const replaceAll = args.replace_all as boolean | undefined

        // 使用智能替换（支持多种容错策略）
        const normalizedContent = normalizeLineEndings(originalContent)
        const normalizedOld = normalizeLineEndings(oldString)
        const normalizedNew = normalizeLineEndings(newString)

        const result = smartReplace(normalizedContent, normalizedOld, normalizedNew, replaceAll)

        if (!result.success) {
            // 使用增强的错误分析
            const { findSimilarContent, analyzeEditError, generateFixSuggestion } = await import('../utils/EditRetryStrategy')
            
            const errorType = analyzeEditError(result.error || '')
            const hasCache = AgentService.hasValidFileCache(path)
            
            // 查找相似内容
            const similar = findSimilarContent(normalizedContent, normalizedOld)
            
            // 生成详细的修复建议
            const suggestion = generateFixSuggestion(errorType, {
                path,
                oldString: normalizedOld,
                similarContent: similar.similarText,
                lineNumber: similar.lineNumber,
            })
            
            let errorMsg = result.error || 'Replace failed'
            
            // 添加上下文信息
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

        // 更新文件缓存
        AgentService.markFileAsRead(path, newContent)
        
        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path)

        const lineChanges = calculateLineChanges(originalContent, newContent)
        
        // 记录使用的匹配策略（用于调试）
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

    async replace_file_content(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const originalContent = await api.file.read(path)
        if (originalContent === null) return { success: false, result: '', error: `File not found: ${path}` }

        // 对于行号替换，建议先读取文件以确保行号准确
        if (!AgentService.hasValidFileCache(path)) {
            logger.agent.warn(`[replace_file_content] File ${path} not in cache, line numbers may be inaccurate`)
        }

        const content = args.content as string
        if (originalContent === '') {
            const success = await api.file.write(path, content)
            if (success) AgentService.markFileAsRead(path, content)
            return success
                ? { success: true, result: 'File written (was empty)', meta: { filePath: path, oldContent: '', newContent: content, linesAdded: content.split('\n').length, linesRemoved: 0 } }
                : { success: false, result: '', error: 'Failed to write file' }
        }

        const lines = originalContent.split('\n')
        const startLine = args.start_line as number
        const endLine = args.end_line as number
        
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
        
        // 更新文件缓存
        AgentService.markFileAsRead(path, newContent)
        
        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path)

        const lineChanges = calculateLineChanges(originalContent, newContent)
        return { success: true, result: 'File updated successfully', meta: { filePath: path, oldContent: originalContent, newContent, linesAdded: lineChanges.added, linesRemoved: lineChanges.removed } }
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
                ? `${output}\n\n[Note: ${result.error}]`
                : result.error
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
            error: undefined // 不设置 error，让 AI 从 result 中判断
        }
    },

    async get_lint_errors(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const errors = await lintService.getLintErrors(path, args.refresh as boolean)
        return { success: true, result: errors.length ? errors.map((e) => `[${e.severity}] ${e.message} (Line ${e.startLine})`).join('\n') : 'No lint errors found.' }
    },

    async codebase_search(args, ctx) {
        if (!ctx.workspacePath) return { success: false, result: '', error: 'No workspace open' }
        const results = await api.index.hybridSearch(ctx.workspacePath, args.query as string, (args.top_k as number) || 10)
        if (!results?.length) return { success: false, result: 'No results found' }
        return { success: true, result: results.map(r => `${r.relativePath}:${r.startLine}: ${r.content.trim()}`).join('\n') }
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
            try { filePath = decodeURIComponent(filePath) } catch {}
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
            try { filePath = decodeURIComponent(filePath) } catch {}
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
            if (s.children) out += (s.children as typeof s[]).map(c => format(c, depth + 1)).join('')
            return out
        }
        return { success: true, result: symbols.map((s) => format(s, 0)).join('') }
    },

    async web_search(args) {
        const result = await api.http.webSearch(args.query as string, args.max_results as number)
        if (!result.success || !result.results) return { success: false, result: '', error: result.error || 'Search failed' }
        return { success: true, result: result.results.map((r) => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n') }
    },

    async read_url(args) {
        const result = await api.http.readUrl(args.url as string, (args.timeout as number) || 30)
        if (!result.success || !result.content) return { success: false, result: '', error: result.error || 'Failed to read URL' }
        return { success: true, result: `Title: ${result.title}\n\n${result.content}` }
    },

    async create_plan(args, ctx) {
        const items = args.items as Array<{ title: string; description?: string }>
        const title = args.title as string | undefined
        useAgentStore.getState().createPlan(items)

        const plan = useAgentStore.getState().plan
        if (plan && ctx.workspacePath) {
            const planData = generatePlanJson(plan, title)
            const planName = title ? title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 30) : `plan_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
            const planFilePath = `${ctx.workspacePath}/.adnify/plans/${planName}.json`

            await api.file.ensureDir(`${ctx.workspacePath}/.adnify/plans`)
            await api.file.write(planFilePath, JSON.stringify(planData, null, 2))

            useStore.getState().openFile(planFilePath, JSON.stringify(planData, null, 2))
            useStore.getState().setActiveFile(planFilePath)
            await api.file.write(`${ctx.workspacePath}/.adnify/active_plan.txt`, planFilePath)

            // 触发任务列表刷新
            window.dispatchEvent(new CustomEvent('plan-list-refresh'))

            return { success: true, result: `Plan created with ${plan.items.length} items` }
        }
        return { success: true, result: 'Plan created successfully' }
    },

    async update_plan(args, ctx) {
        const store = useAgentStore.getState()
        const plan = store.plan

        // 参数校验
        if (!plan) {
            return { success: false, result: '', error: 'No active plan. Use create_plan first.' }
        }

        if (!args.items && !args.status) {
            return { 
                success: false, 
                result: '', 
                error: 'Missing required parameter "items". Usage: update_plan items=[{id:"1", status:"completed"}]' 
            }
        }

        // 校验 items 格式
        if (args.items) {
            const items = args.items as Array<unknown>
            if (!Array.isArray(items)) {
                return { success: false, result: '', error: 'Parameter "items" must be an array.' }
            }
            for (const item of items) {
                if (typeof item !== 'object' || item === null) {
                    return { success: false, result: '', error: 'Each item must be an object with id and status.' }
                }
                const { id, status } = item as Record<string, unknown>
                if (!id && !status) {
                    return { success: false, result: '', error: 'Each item must have at least "id" or "status" field.' }
                }
                if (status && !['pending', 'in_progress', 'completed', 'failed', 'skipped'].includes(status as string)) {
                    return { 
                        success: false, 
                        result: '', 
                        error: `Invalid status "${status}". Must be one of: pending, in_progress, completed, failed, skipped` 
                    }
                }
            }
        }

        if (args.status) store.updatePlanStatus(args.status as 'draft' | 'active' | 'completed' | 'failed')

        const updatedItems: string[] = []
        if (args.items && plan) {
            for (const item of args.items as Array<{ id?: string; status?: string; title?: string }>) {
                let targetId = item.id
                if (!targetId && item.title) {
                    const match = plan.items.find((p: PlanItem) => p.title === item.title)
                    if (match) targetId = match.id
                }
                if (!targetId) continue

                let matchedItem = plan.items.find((p: PlanItem) => p.id === targetId)
                if (!matchedItem && targetId.length >= 4) {
                    const prefixMatches = plan.items.filter((p: PlanItem) => p.id.startsWith(targetId!))
                    if (prefixMatches.length === 1) matchedItem = prefixMatches[0]
                }
                if (!matchedItem) {
                    const idx = parseInt(targetId, 10)
                    if (!isNaN(idx)) {
                        const adjustedIdx = idx > 0 && idx <= plan.items.length ? idx - 1 : idx
                        if (adjustedIdx >= 0 && adjustedIdx < plan.items.length) matchedItem = plan.items[adjustedIdx]
                    }
                }

                if (matchedItem) {
                    const updates: Partial<PlanItem> = {}
                    if (item.status) updates.status = item.status as PlanItem['status']
                    if (item.title) updates.title = item.title
                    store.updatePlanItem(matchedItem.id, updates)
                    updatedItems.push(`#${plan.items.indexOf(matchedItem) + 1} → ${item.status || 'updated'}`)
                }
            }
        }

        // 同步 JSON 文件
        const updatedPlan = useAgentStore.getState().plan
        if (updatedPlan && ctx.workspacePath) {
            let planFilePath = await api.file.read(`${ctx.workspacePath}/.adnify/active_plan.txt`)
            planFilePath = (planFilePath || `${ctx.workspacePath}/.adnify/plans/plan.json`).trim()

            // 读取现有 JSON 获取标题
            let finalTitle = args.title as string | undefined
            if (!finalTitle && planFilePath.endsWith('.json')) {
                try {
                    const oldContent = await api.file.read(planFilePath)
                    if (oldContent) {
                        const oldData = JSON.parse(oldContent) as PlanFileData
                        finalTitle = oldData.title
                    }
                } catch { /* ignore */ }
            }

            const planData = generatePlanJson(updatedPlan, finalTitle)
            const planContent = JSON.stringify(planData, null, 2)
            await api.file.write(planFilePath, planContent)

            try {
                const openFile = useStore.getState().openFiles.find((f: { path: string }) => f.path === planFilePath)
                if (openFile) useStore.getState().reloadFileFromDisk(planFilePath, planContent)
            } catch (err) {
                logger.agent.error('[update_plan] Failed to sync editor:', err)
            }
            
            // 触发任务列表刷新
            window.dispatchEvent(new CustomEvent('plan-list-refresh'))
        }

        const resultMsg = updatedItems.length > 0 
            ? `Plan updated: ${updatedItems.join(', ')}` 
            : 'Plan updated successfully'
        return { success: true, result: resultMsg }
    },

    async ask_user(args, ctx) {
        const question = args.question as string
        const options = args.options as Array<{ id: string; label: string; description?: string }>
        const multiSelect = (args.multiSelect as boolean) || false
        const targetMessageId = ctx.currentAssistantId
        
        if (targetMessageId) {
            const state = useAgentStore.getState()
            const threadId = state.currentThreadId
            
            if (threadId) {
                const thread = state.threads[threadId]
                if (thread) {
                    const msgIndex = thread.messages.findIndex(m => m.id === targetMessageId)
                    if (msgIndex !== -1) {
                        const newMessages = [...thread.messages]
                        const message = newMessages[msgIndex]
                        if (message.role === 'assistant') {
                            newMessages[msgIndex] = {
                                ...message,
                                interactive: { type: 'interactive', question, options, multiSelect },
                                isStreaming: false,
                            }
                            
                            useAgentStore.setState({
                                threads: {
                                    ...state.threads,
                                    [threadId]: { ...thread, messages: newMessages, lastModified: Date.now() },
                                },
                            })
                        }
                    }
                }
            }
        }

        return {
            success: true,
            result: `Waiting for user to select from options. Question: "${question}"`,
            meta: { waitingForUser: true },
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
                const result = await uiuxDatabase.searchStack(query, stack as any, maxResults)
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
            const result = await uiuxDatabase.search(query, domain as any, maxResults)
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
        } catch (error: any) {
            return {
                success: false,
                result: '',
                error: `UI/UX search failed: ${error.message}`,
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
        } catch (error: any) {
            return {
                success: false,
                result: '',
                error: `UI/UX recommendation failed: ${error.message}`,
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
 */
export async function initializeTools(): Promise<void> {
    const { toolRegistry } = await import('./registry')
    toolRegistry.registerAll(toolExecutors)
}
