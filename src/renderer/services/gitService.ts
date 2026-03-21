import { api } from '@/renderer/services/electronAPI'
import { toAppError } from '@shared/utils/errorHandler'
import { logger } from '@utils/Logger'
import { normalizePath, toRelativePath } from '@shared/utils/pathUtils'

/**
 * Git 服务 (使用安全的 Git API)
 * 支持多根目录工作区
 * 增强功能: rebase, cherry-pick, stash 管理, 冲突解决等
 */

/**
 * 处理 Git 错误的辅助函数
 */
function handleGitError(err: unknown): string {
    const error = toAppError(err)
    return error.message
}

export interface GitStatus {
    branch: string
    ahead: number
    behind: number
    staged: GitFileChange[]
    unstaged: GitFileChange[]
    untracked: string[]
    hasConflicts: boolean
    conflictFiles: string[]
}

export interface GitFileChange {
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged'
    oldPath?: string
    additions?: number
    deletions?: number
}

export interface GitCommit {
    hash: string
    shortHash: string
    message: string
    author: string
    email?: string
    date: Date
    parents?: string[]
}

export interface GitStashEntry {
    index: number
    message: string
    branch: string
    date?: Date
}

export interface GitBranch {
    name: string
    current: boolean
    remote: boolean
    upstream?: string
    ahead?: number
    behind?: number
    lastCommit?: string
}

interface GitExecResult {
    stdout: string
    stderr: string
    exitCode: number
}

class GitService {
    private primaryWorkspacePath: string | null = null

    setWorkspace(path: string | null) {
        this.primaryWorkspacePath = path
    }

    getWorkspace(): string | null {
        return this.primaryWorkspacePath
    }

    /**
     * 执行 Git 命令 (使用安全的 gitExecSecure API)
     */
    private async exec(args: string[], rootPath?: string): Promise<GitExecResult> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) {
            return { stdout: '', stderr: 'No workspace', exitCode: 1 }
        }

        try {
            const normalizedPath = normalizePath(targetPath)
            // 注入 -c core.quotePath=false 来防止 Git 把中文路径转义和加引号（导致 stage/unstage 找不到文件）
            const fullArgs = ['-c', 'core.quotePath=false', ...args]
            const result = await api.git.execSecure(fullArgs, normalizedPath)
            const exitCode = result.success === false ? (result.exitCode ?? 1) : (result.exitCode || 0)
            return {
                stdout: result.stdout || '',
                stderr: result.stderr || result.error || '',
                exitCode
            }
        } catch (err) {
            return {
                stdout: '',
                stderr: handleGitError(err),
                exitCode: 1
            }
        }
    }

    /**
     * 检查是否是 Git 仓库
     */
    async isGitRepo(rootPath?: string): Promise<boolean> {
        try {
            const result = await this.exec(['rev-parse', '--is-inside-work-tree'], rootPath)
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 获取当前分支
     */
    async getCurrentBranch(rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['branch', '--show-current'], rootPath)
            return result.exitCode === 0 ? result.stdout.trim() : null
        } catch {
            return null
        }
    }

    /**
     * 获取 Git 状态
     */
    async getStatus(rootPath?: string): Promise<GitStatus | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null

        try {
            // 并行执行 branch 和 status 命令（status 不依赖 branch 结果，可以并行）
            const [branchResult, statusResult] = await Promise.all([
                this.exec(['branch', '--show-current'], targetRoot),
                this.exec(['status', '--porcelain=v1', '-uall'], targetRoot),
            ])

            // 获取分支信息
            let branch = 'HEAD'
            if (branchResult.exitCode === 0 && branchResult.stdout.trim()) {
                branch = branchResult.stdout.trim()
            } else {
                const revParseResult = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'], targetRoot)
                if (revParseResult.exitCode === 0 && revParseResult.stdout.trim()) {
                    branch = revParseResult.stdout.trim()
                }
            }

            // 获取 ahead/behind（依赖 branch 结果）
            let ahead = 0, behind = 0
            try {
                const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], targetRoot)
                if (aheadBehind.exitCode === 0) {
                    const parts = aheadBehind.stdout.trim().split(/\s+/)
                    if (parts.length >= 2) {
                        behind = Number(parts[0]) || 0
                        ahead = Number(parts[1]) || 0
                    }
                }
            } catch { /* 无上游 */ }

            const staged: GitFileChange[] = []
            const unstaged: GitFileChange[] = []
            const untracked: string[] = []
            const conflictFiles: string[] = []
            let hasConflicts = false

            if (statusResult.exitCode === 0 && statusResult.stdout) {
                const lines = statusResult.stdout.split('\n').filter(Boolean)

                for (const line of lines) {
                    if (line.length < 4) continue

                    const X = line[0]
                    const Y = line[1]
                    let fullPathPart = line.slice(3)

                    // 处理重命名 (format: R  old -> new)
                    let currentPath = fullPathPart
                    if (X === 'R' || Y === 'R') {
                        const parts = fullPathPart.split(' -> ')
                        currentPath = parts[parts.length - 1] // 获取新路径
                    }

                    // 1. 检测冲突 (indexStatus/workTreeStatus 为 U, 或特定的 AA, DD 等)
                    const isConflict = (X === 'U' || Y === 'U' || (X === 'A' && Y === 'A') || (X === 'D' && Y === 'D'))
                    if (isConflict) {
                        hasConflicts = true
                        conflictFiles.push(currentPath)
                        continue
                    }

                    // 2. 检测未跟踪
                    if (X === '?' && Y === '?') {
                        if (!currentPath.endsWith('/')) {
                            untracked.push(currentPath)
                        }
                        continue
                    }

                    // 3. 暂存区状态 (X)
                    if (X !== ' ' && X !== '?') {
                        staged.push({
                            path: currentPath,
                            status: this.parseStatus(X),
                        })
                    }

                    // 4. 工作区状态 (Y)
                    if (Y !== ' ' && Y !== '?') {
                        unstaged.push({
                            path: currentPath,
                            status: this.parseStatus(Y),
                        })
                    }
                }
            }

            return { branch, ahead, behind, staged, unstaged, untracked, hasConflicts, conflictFiles }
        } catch (err) {
            logger.git.error('[GitService] getStatus failed:', err)
            return null
        }
    }

    private parseStatus(char: string): GitFileChange['status'] {
        switch (char) {
            case 'A': return 'added'
            case 'M': return 'modified'
            case 'D': return 'deleted'
            case 'R': return 'renamed'
            case 'C': return 'copied'
            case 'U': return 'unmerged'
            default: return 'modified'
        }
    }

    /**
     * 获取文件 diff
     */
    async getFileDiff(filePath: string, staged: boolean = false, rootPath?: string): Promise<string | null> {
        try {
            const args = staged
                ? ['diff', '--cached', '--', filePath]
                : ['diff', '--', filePath]
            const result = await this.exec(args, rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch {
            return null
        }
    }

    /**
     * 获取两个 commit 之间的 diff
     */
    async getCommitDiff(commitHash: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['show', '--format=', '--patch', commitHash], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch {
            return null
        }
    }

    /**
     * 获取 HEAD 版本的文件内容
     */
    async getHeadFileContent(absolutePath: string, rootPath?: string): Promise<string | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null

        const relativePath = toRelativePath(absolutePath, targetRoot)

        try {
            const fullArgs = ['-c', 'core.quotePath=false', 'show', `HEAD:${relativePath}`]
            const result = await api.git.execSecure(fullArgs, targetRoot)
            if (result.success !== false && result.exitCode === 0) {
                return result.stdout || ''
            }
            return ''
        } catch {
            return ''
        }
    }

    /**
     * 获取暂存区(Index)版本的文件内容
     */
    async getIndexFileContent(absolutePath: string, rootPath?: string): Promise<string | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null

        const relativePath = toRelativePath(absolutePath, targetRoot)

        try {
            const fullArgs = ['-c', 'core.quotePath=false', 'show', `:${relativePath}`]
            const result = await api.git.execSecure(fullArgs, targetRoot)
            if (result.success !== false && result.exitCode === 0) {
                return result.stdout || ''
            }
            return ''
        } catch {
            return ''
        }
    }

    /**
     * 获取指定 commit 的文件内容
     */
    async getFileContentAtCommit(filePath: string, commitHash: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['show', `${commitHash}:${filePath}`], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch {
            return null
        }
    }

    // ==================== 基础操作 ====================

    async stageFile(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['add', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async stageAll(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['add', '-A'], rootPath)
        return result.exitCode === 0
    }

    async unstageFile(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['reset', 'HEAD', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async unstageAll(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['reset', 'HEAD'], rootPath)
        return result.exitCode === 0
    }

    async discardChanges(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['checkout', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async discardAllChanges(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['checkout', '--', '.'], rootPath)
        return result.exitCode === 0
    }

    async commit(message: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['commit', '-m', message], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async commitAmend(message?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message
                ? ['commit', '--amend', '-m', message]
                : ['commit', '--amend', '--no-edit']
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async init(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['init'], rootPath)
        return result.exitCode === 0
    }

    // ==================== 远程操作 ====================

    async pull(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['pull'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async push(rootPath?: string, force?: boolean): Promise<{ success: boolean; error?: string }> {
        try {
            const args = force ? ['push', '--force-with-lease'] : ['push']
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async fetch(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['fetch', '--all', '--prune'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async getRemotes(rootPath?: string): Promise<{ name: string; url: string; type: 'fetch' | 'push' }[]> {
        try {
            const result = await this.exec(['remote', '-v'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            const remotes: { name: string; url: string; type: 'fetch' | 'push' }[] = []
            const lines = result.stdout.trim().split('\n').filter(Boolean)

            for (const line of lines) {
                const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
                if (match) {
                    remotes.push({
                        name: match[1],
                        url: match[2],
                        type: match[3] as 'fetch' | 'push',
                    })
                }
            }

            return remotes
        } catch {
            return []
        }
    }

    // ==================== 分支操作 ====================

    async getBranches(rootPath?: string): Promise<GitBranch[]> {
        try {
            // 使用简单的 branch -a 命令
            const result = await this.exec(['branch', '-a', '-v'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            const branches: GitBranch[] = []
            const lines = result.stdout.trim().split('\n').filter(Boolean)

            for (const line of lines) {
                const current = line.startsWith('*')
                const trimmed = line.replace(/^\*?\s+/, '')

                // 解析分支名和 commit hash
                const parts = trimmed.split(/\s+/)
                let name = parts[0]
                const commitHash = parts[1] || ''

                // 跳过 HEAD 指针
                if (name === 'HEAD' || name.includes('->')) continue

                const remote = name.startsWith('remotes/')
                if (remote) {
                    name = name.replace('remotes/', '')
                }

                branches.push({
                    name,
                    current,
                    remote,
                    lastCommit: commitHash.slice(0, 7)
                })
            }

            // 为当前分支获取 ahead/behind 信息
            const currentBranch = branches.find(b => b.current)
            if (currentBranch) {
                try {
                    const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], rootPath)
                    if (aheadBehind.exitCode === 0) {
                        const parts = aheadBehind.stdout.trim().split(/\s+/)
                        if (parts.length >= 2) {
                            currentBranch.behind = Number(parts[0]) || 0
                            currentBranch.ahead = Number(parts[1]) || 0
                        }
                    }
                } catch {
                    // 没有上游分支
                }
            }

            return branches
        } catch {
            return []
        }
    }

    async checkoutBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['checkout', name], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async createBranch(name: string, startPoint?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = startPoint
                ? ['checkout', '-b', name, startPoint]
                : ['checkout', '-b', name]
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async deleteBranch(name: string, force?: boolean, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = force ? ['branch', '-D', name] : ['branch', '-d', name]
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async deleteRemoteBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            // name 格式为 "origin/branchName"，需要拆分出 remote 和 branch
            const slashIndex = name.indexOf('/')
            if (slashIndex === -1) {
                return { success: false, error: 'Invalid remote branch name format' }
            }
            const remote = name.slice(0, slashIndex)
            const branch = name.slice(slashIndex + 1)
            const result = await this.exec(['push', remote, '--delete', branch], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async renameBranch(oldName: string, newName: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['branch', '-m', oldName, newName], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== Merge 操作 ====================

    async mergeBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string; conflicts?: string[] }> {
        try {
            const result = await this.exec(['merge', name], rootPath)

            if (result.exitCode !== 0) {
                const statusResult = await this.exec(['status', '--porcelain'], rootPath)
                const conflicts = statusResult.stdout
                    .split('\n')
                    .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD'))
                    .map(line => line.slice(3).trim())

                return {
                    success: false,
                    error: result.stderr || 'Merge conflict',
                    conflicts: conflicts.length > 0 ? conflicts : undefined,
                }
            }

            return { success: true }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async abortMerge(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['merge', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== Rebase 操作 ====================

    async rebase(branch: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', branch], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async rebaseContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--continue'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async rebaseAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async rebaseSkip(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--skip'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== Cherry-pick 操作 ====================

    async cherryPick(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async cherryPickContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--continue'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async cherryPickAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== Stash 操作 ====================

    async stash(message?: string, includeUntracked?: boolean, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = ['stash', 'push']
            if (includeUntracked) args.push('-u')
            if (message) args.push('-m', message)
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async stashApply(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'apply', `stash@{${index}}`], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async stashPop(index?: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = index !== undefined
                ? ['stash', 'pop', `stash@{${index}}`]
                : ['stash', 'pop']
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async stashDrop(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'drop', `stash@{${index}}`], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async stashClear(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'clear'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async getStashList(rootPath?: string): Promise<GitStashEntry[]> {
        try {
            const result = await this.exec(['stash', 'list', '--format=%gd%x00%gs%x00%ci'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
                const parts = line.split('\0')
                const indexMatch = parts[0]?.match(/stash@\{(\d+)\}/)
                const index = indexMatch ? parseInt(indexMatch[1]) : 0
                const message = parts[1] || ''
                const branchMatch = message.match(/^On\s+(\S+):\s*(.*)$/)

                return {
                    index,
                    branch: branchMatch?.[1] || 'unknown',
                    message: branchMatch?.[2] || message,
                    date: parts[2] ? new Date(parts[2]) : undefined,
                }
            })
        } catch {
            return []
        }
    }

    async getStashDiff(index: number, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['stash', 'show', '-p', `stash@{${index}}`], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch {
            return null
        }
    }

    // ==================== 提交历史 ====================

    async getRecentCommits(count: number = 20, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec([
                'log',
                `-${count}`,
                '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P'
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr, parents] = line.split('\0')
                return {
                    hash,
                    shortHash,
                    message,
                    author,
                    email,
                    date: new Date(dateStr),
                    parents: parents ? parents.split(' ').filter(Boolean) : [],
                }
            })
        } catch {
            return []
        }
    }

    async getCommitDetails(hash: string, rootPath?: string): Promise<{
        commit: GitCommit
        files: { path: string; status: string; additions: number; deletions: number }[]
    } | null> {
        try {
            // 获取 commit 信息
            const infoResult = await this.exec([
                'show', hash, '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P', '--stat', '--stat-width=1000'
            ], rootPath)

            if (infoResult.exitCode !== 0) return null

            const lines = infoResult.stdout.trim().split('\n')
            const [hash_, shortHash, message, author, email, dateStr, parents] = lines[0].split('\0')

            const commit: GitCommit = {
                hash: hash_,
                shortHash,
                message,
                author,
                email,
                date: new Date(dateStr),
                parents: parents ? parents.split(' ').filter(Boolean) : [],
            }

            // 解析文件变更
            const files: { path: string; status: string; additions: number; deletions: number }[] = []
            const numstatResult = await this.exec(['show', hash, '--numstat', '--format='], rootPath)

            if (numstatResult.exitCode === 0 && numstatResult.stdout) {
                const statLines = numstatResult.stdout.trim().split('\n').filter(Boolean)
                for (const line of statLines) {
                    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/)
                    if (match) {
                        files.push({
                            path: match[3],
                            status: 'modified',
                            additions: match[1] === '-' ? 0 : parseInt(match[1]),
                            deletions: match[2] === '-' ? 0 : parseInt(match[2]),
                        })
                    }
                }
            }

            return { commit, files }
        } catch {
            return null
        }
    }

    async getFileHistory(filePath: string, count: number = 20, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec([
                'log',
                `-${count}`,
                '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI',
                '--follow',
                '--',
                filePath
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('\0')
                return {
                    hash,
                    shortHash,
                    message,
                    author,
                    email,
                    date: new Date(dateStr),
                }
            })
        } catch {
            return []
        }
    }

    async getBranchCommits(branch: string, count: number = 50, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec([
                'log', branch,
                `-${count}`,
                '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI'
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('\0')
                return {
                    hash,
                    shortHash,
                    message,
                    author,
                    email,
                    date: new Date(dateStr),
                }
            })
        } catch {
            return []
        }
    }

    // ==================== Reset 操作 ====================

    async resetSoft(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--soft', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async resetMixed(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--mixed', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async resetHard(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--hard', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async revertCommit(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['revert', '--no-commit', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== 标签操作 ====================

    async getTags(rootPath?: string): Promise<{ name: string; hash: string; message?: string }[]> {
        try {
            const result = await this.exec(['tag', '-l', '--format=%(refname:short)%00%(objectname:short)%00%(contents:subject)'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [name, hash, message] = line.split('\0')
                return { name, hash, message }
            })
        } catch {
            return []
        }
    }

    async createTag(name: string, message?: string, commitHash?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message
                ? ['tag', '-a', name, '-m', message]
                : ['tag', name]
            if (commitHash) args.push(commitHash)

            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async deleteTag(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['tag', '-d', name], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ==================== 工具方法 ====================

    async getGitConfig(key: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['config', '--get', key], rootPath)
            return result.exitCode === 0 ? result.stdout.trim() : null
        } catch {
            return null
        }
    }

    async setGitConfig(key: string, value: string, global?: boolean, rootPath?: string): Promise<boolean> {
        try {
            const args = global
                ? ['config', '--global', key, value]
                : ['config', key, value]
            const result = await this.exec(args, rootPath)
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 检查是否处于 rebase/merge/cherry-pick 状态
     */
    async getOperationState(rootPath?: string): Promise<'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) return 'normal'

        try {
            // 通过 git rev-parse --verify 检查特殊引用来判断操作状态
            // 这些引用 (REBASE_HEAD, MERGE_HEAD 等) 在对应操作进行时由 git 自动创建
            // 比解析 git status 的本地化文本输出更可靠
            const checkRef = async (ref: string): Promise<boolean> => {
                const result = await this.exec(
                    ['rev-parse', '--verify', '--quiet', ref],
                    targetPath
                ).catch(() => null)
                return result?.exitCode === 0
            }

            // 检查顺序: rebase > merge > cherry-pick > revert
            if (await checkRef('REBASE_HEAD')) return 'rebase'
            if (await checkRef('MERGE_HEAD')) return 'merge'
            if (await checkRef('CHERRY_PICK_HEAD')) return 'cherry-pick'
            if (await checkRef('REVERT_HEAD')) return 'revert'

            return 'normal'
        } catch {
            return 'normal'
        }
    }

    /**
     * 获取 blame 信息
     */
    async getBlame(filePath: string, rootPath?: string): Promise<{ line: number; hash: string; author: string; date: Date; content: string }[]> {
        try {
            const result = await this.exec(['blame', '--line-porcelain', filePath], rootPath)
            if (result.exitCode !== 0) return []

            const lines: { line: number; hash: string; author: string; date: Date; content: string }[] = []
            const chunks = result.stdout.split(/^([a-f0-9]{40})/m).filter(Boolean)

            let lineNum = 0
            for (let i = 0; i < chunks.length; i += 2) {
                const hash = chunks[i]
                const info = chunks[i + 1] || ''

                const authorMatch = info.match(/^author (.+)$/m)
                const timeMatch = info.match(/^author-time (\d+)$/m)
                const contentMatch = info.match(/^\t(.*)$/m)

                if (authorMatch && timeMatch) {
                    lineNum++
                    lines.push({
                        line: lineNum,
                        hash: hash.slice(0, 8),
                        author: authorMatch[1],
                        date: new Date(parseInt(timeMatch[1]) * 1000),
                        content: contentMatch?.[1] || '',
                    })
                }
            }

            return lines
        } catch {
            return []
        }
    }
}

export const gitService = new GitService()
