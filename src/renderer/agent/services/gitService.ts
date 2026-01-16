import { api } from '@/renderer/services/electronAPI'

/**
 * Git 服务 (使用安全的 Git API)
 * 支持多根目录工作区
 * 增强功能: rebase, cherry-pick, stash 管理, 冲突解决等
 */

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
            const result = await api.git.execSecure(args, targetPath)
            return {
                stdout: result.stdout || '',
                stderr: result.stderr || '',
                exitCode: result.exitCode || 0
            }
        } catch (error: any) {
            return {
                stdout: '',
                stderr: error?.message || 'Git execution failed',
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
        try {
            // 获取分支信息 - 使用多种方式确保获取到分支名
            let branch = 'HEAD'
            
            // 方法1: git branch --show-current (Git 2.22+)
            const branchResult = await this.exec(['branch', '--show-current'], rootPath)
            if (branchResult.exitCode === 0 && branchResult.stdout.trim()) {
                branch = branchResult.stdout.trim()
            } else {
                // 方法2: git rev-parse --abbrev-ref HEAD (兼容旧版本)
                const revParseResult = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath)
                if (revParseResult.exitCode === 0 && revParseResult.stdout.trim()) {
                    branch = revParseResult.stdout.trim()
                } else {
                    // 方法3: git symbolic-ref --short HEAD (最后尝试)
                    const symbolicResult = await this.exec(['symbolic-ref', '--short', 'HEAD'], rootPath)
                    if (symbolicResult.exitCode === 0 && symbolicResult.stdout.trim()) {
                        branch = symbolicResult.stdout.trim()
                    }
                }
            }

            // 获取 ahead/behind
            let ahead = 0, behind = 0
            try {
                const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], rootPath)
                if (aheadBehind.exitCode === 0) {
                    const parts = aheadBehind.stdout.trim().split(/\s+/)
                    if (parts.length >= 2) {
                        behind = Number(parts[0]) || 0
                        ahead = Number(parts[1]) || 0
                    }
                }
            } catch {
                // 没有上游分支
            }

            // 获取状态 (porcelain v1 格式, -uall 显示所有未跟踪文件而非目录)
            const statusResult = await this.exec(['status', '--porcelain=v1', '-uall'], rootPath)

            const staged: GitFileChange[] = []
            const unstaged: GitFileChange[] = []
            const untracked: string[] = []
            const conflictFiles: string[] = []
            let hasConflicts = false

            if (statusResult.exitCode === 0 && statusResult.stdout) {
                const lines = statusResult.stdout.trim().split('\n').filter(Boolean)

                for (const line of lines) {
                    const indexStatus = line[0]
                    const workTreeStatus = line[1]
                    const filePath = line.slice(3).trim()

                    // 检测冲突文件
                    if (indexStatus === 'U' || workTreeStatus === 'U' ||
                        (indexStatus === 'A' && workTreeStatus === 'A') ||
                        (indexStatus === 'D' && workTreeStatus === 'D')) {
                        hasConflicts = true
                        conflictFiles.push(filePath)
                        continue
                    }

                    if (indexStatus === '?' && workTreeStatus === '?') {
                        // 过滤掉文件夹（以 / 结尾的路径）
                        if (!filePath.endsWith('/')) {
                            untracked.push(filePath)
                        }
                        continue
                    }

                    if (indexStatus !== ' ' && indexStatus !== '?') {
                        staged.push({
                            path: filePath,
                            status: this.parseStatus(indexStatus),
                        })
                    }

                    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
                        unstaged.push({
                            path: filePath,
                            status: this.parseStatus(workTreeStatus),
                        })
                    }
                }
            }

            return { branch, ahead, behind, staged, unstaged, untracked, hasConflicts, conflictFiles }
        } catch {
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

        // 转换为相对路径
        let relativePath = absolutePath
        // 标准化路径分隔符
        const normalizedAbsPath = absolutePath.replace(/\\/g, '/')
        const normalizedRoot = targetRoot.replace(/\\/g, '/')
        
        if (normalizedAbsPath.startsWith(normalizedRoot)) {
            relativePath = normalizedAbsPath.slice(normalizedRoot.length)
            if (relativePath.startsWith('/')) {
                relativePath = relativePath.slice(1)
            }
        } else {
            // 如果不是以 root 开头，尝试直接使用
            relativePath = absolutePath.replace(/\\/g, '/')
        }

        try {
            const result = await this.exec(['show', `HEAD:${relativePath}`], targetRoot)
            if (result.exitCode === 0) {
                return result.stdout
            }
            // 文件可能是新文件，返回空字符串
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
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async fetch(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['fetch', '--all', '--prune'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async renameBranch(oldName: string, newName: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['branch', '-m', oldName, newName], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async abortMerge(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['merge', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    // ==================== Rebase 操作 ====================

    async rebase(branch: string, interactive?: boolean, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = interactive 
                ? ['rebase', '-i', branch]
                : ['rebase', branch]
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async rebaseContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--continue'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async rebaseAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async rebaseSkip(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--skip'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async cherryPickContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--continue'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async cherryPickAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--abort'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async stashApply(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'apply', `stash@{${index}}`], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async stashDrop(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'drop', `stash@{${index}}`], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async stashClear(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'clear'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async getStashList(rootPath?: string): Promise<GitStashEntry[]> {
        try {
            const result = await this.exec(['stash', 'list', '--format=%gd|%gs|%ci'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
                const parts = line.split('|')
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
                '--pretty=format:%H|%h|%s|%an|%ae|%aI|%P'
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr, parents] = line.split('|')
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
                'show', hash, '--format=%H|%h|%s|%an|%ae|%aI|%P', '--stat', '--stat-width=1000'
            ], rootPath)

            if (infoResult.exitCode !== 0) return null

            const lines = infoResult.stdout.trim().split('\n')
            const [hash_, shortHash, message, author, email, dateStr, parents] = lines[0].split('|')

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
                '--pretty=format:%H|%h|%s|%an|%ae|%aI',
                '--follow',
                '--',
                filePath
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('|')
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
                '--pretty=format:%H|%h|%s|%an|%ae|%aI'
            ], rootPath)

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('|')
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async resetMixed(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--mixed', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async resetHard(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--hard', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async revertCommit(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['revert', '--no-commit', commitHash], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    // ==================== 标签操作 ====================

    async getTags(rootPath?: string): Promise<{ name: string; hash: string; message?: string }[]> {
        try {
            const result = await this.exec(['tag', '-l', '--format=%(refname:short)|%(objectname:short)|%(contents:subject)'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [name, hash, message] = line.split('|')
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
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async deleteTag(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['tag', '-d', name], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: any) {
            return { success: false, error: e.message }
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
            // 检查 .git 目录下的状态文件
            const checks = [
                { file: 'MERGE_HEAD', state: 'merge' as const },
                { file: 'rebase-merge', state: 'rebase' as const },
                { file: 'rebase-apply', state: 'rebase' as const },
                { file: 'CHERRY_PICK_HEAD', state: 'cherry-pick' as const },
                { file: 'REVERT_HEAD', state: 'revert' as const },
            ]

            for (const check of checks) {
                const result = await this.exec(['rev-parse', '--git-path', check.file], targetPath)
                if (result.exitCode === 0) {
                    const gitPath = result.stdout.trim()
                    // 检查文件是否存在 (gitPath is used for debugging if needed)
                    void gitPath
                    const existsResult = await this.exec(['rev-parse', '--verify', '--quiet', 'HEAD'], targetPath)
                    if (existsResult.exitCode === 0) {
                        // 简单检查：如果能获取到路径，假设状态存在
                        const statusResult = await this.exec(['status'], targetPath)
                        if (statusResult.stdout.includes('rebase in progress')) return 'rebase'
                        if (statusResult.stdout.includes('merge in progress') || statusResult.stdout.includes('Unmerged')) return 'merge'
                        if (statusResult.stdout.includes('cherry-pick')) return 'cherry-pick'
                        if (statusResult.stdout.includes('revert')) return 'revert'
                    }
                }
            }

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
