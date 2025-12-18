/**
 * Git 服务 (使用安全的 Git API)
 */

export interface GitStatus {
    branch: string
    ahead: number
    behind: number
    staged: GitFileChange[]
    unstaged: GitFileChange[]
    untracked: string[]
}

export interface GitFileChange {
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed'
    oldPath?: string
}

export interface GitCommit {
    hash: string
    shortHash: string
    message: string
    author: string
    date: Date
}

interface GitExecResult {
    stdout: string
    stderr: string
    exitCode: number
}

class GitService {
    private workspacePath: string | null = null

    setWorkspace(path: string | null) {
        this.workspacePath = path
    }

    /**
     * 执行 Git 命令 (使用安全的 gitExecSecure API)
     */
    private async exec(args: string[]): Promise<GitExecResult> {
        if (!this.workspacePath) {
            return { stdout: '', stderr: 'No workspace', exitCode: 1 }
        }

        // 使用安全的 git:execSecure API
        try {
            const result = await window.electronAPI.gitExecSecure(args, this.workspacePath)
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
    async isGitRepo(): Promise<boolean> {
        if (!this.workspacePath) return false
        try {
            const result = await this.exec(['rev-parse', '--is-inside-work-tree'])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 获取当前分支
     */
    async getCurrentBranch(): Promise<string | null> {
        try {
            const result = await this.exec(['branch', '--show-current'])
            return result.exitCode === 0 ? result.stdout.trim() : null
        } catch {
            return null
        }
    }

    /**
     * 获取 Git 状态
     */
    async getStatus(): Promise<GitStatus | null> {
        if (!this.workspacePath) return null

        try {
            // 获取分支信息
            const branchResult = await this.exec(['branch', '--show-current'])
            const branch = branchResult.stdout.trim() || 'HEAD'

            // 获取 ahead/behind
            let ahead = 0, behind = 0
            try {
                const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
                if (aheadBehind.exitCode === 0) {
                    const [b, a] = aheadBehind.stdout.trim().split(/\s+/).map(Number)
                    ahead = a || 0
                    behind = b || 0
                }
            } catch {
                // 没有上游分支
            }

            // 获取状态 (porcelain v1 格式)
            const statusResult = await this.exec(['status', '--porcelain=v1'])

            const staged: GitFileChange[] = []
            const unstaged: GitFileChange[] = []
            const untracked: string[] = []

            if (statusResult.exitCode === 0 && statusResult.stdout) {
                const lines = statusResult.stdout.trim().split('\n').filter(Boolean)

                for (const line of lines) {
                    const indexStatus = line[0]
                    const workTreeStatus = line[1]
                    const filePath = line.slice(3).trim()

                    // 未跟踪文件
                    if (indexStatus === '?' && workTreeStatus === '?') {
                        untracked.push(filePath)
                        continue
                    }

                    // 暂存区变更
                    if (indexStatus !== ' ' && indexStatus !== '?') {
                        staged.push({
                            path: filePath,
                            status: this.parseStatus(indexStatus),
                        })
                    }

                    // 工作区变更
                    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
                        unstaged.push({
                            path: filePath,
                            status: this.parseStatus(workTreeStatus),
                        })
                    }
                }
            }

            return { branch, ahead, behind, staged, unstaged, untracked }
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
            default: return 'modified'
        }
    }

    /**
     * 获取文件 diff
     */
    async getFileDiff(filePath: string, staged: boolean = false): Promise<string | null> {
        try {
            const args = staged
                ? ['diff', '--cached', '--', filePath]
                : ['diff', '--', filePath]
            const result = await this.exec(args)
            return result.exitCode === 0 ? result.stdout : null
        } catch {
            return null
        }
    }

    /**
     * 获取 HEAD 版本的文件内容
     */
    async getHeadFileContent(absolutePath: string): Promise<string | null> {
        if (!this.workspacePath) return null

        // 转换为相对路径
        let relativePath = absolutePath
        if (absolutePath.startsWith(this.workspacePath)) {
            relativePath = absolutePath.slice(this.workspacePath.length)
            if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
                relativePath = relativePath.slice(1)
            }
        }
        // 统一使用正斜杠
        relativePath = relativePath.replace(/\\/g, '/')

        try {
            const result = await this.exec(['show', `HEAD:${relativePath}`])
            return result.exitCode === 0 ? result.stdout : ''
        } catch {
            return ''
        }
    }

    /**
     * 暂存文件
     */
    async stageFile(filePath: string): Promise<boolean> {
        try {
            const result = await this.exec(['add', '--', filePath])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 暂存所有文件
     */
    async stageAll(): Promise<boolean> {
        try {
            const result = await this.exec(['add', '-A'])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 取消暂存文件
     */
    async unstageFile(filePath: string): Promise<boolean> {
        try {
            const result = await this.exec(['reset', 'HEAD', '--', filePath])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 放弃文件更改
     */
    async discardChanges(filePath: string): Promise<boolean> {
        try {
            const result = await this.exec(['checkout', '--', filePath])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 获取最近提交
     */
    async getRecentCommits(count: number = 10): Promise<GitCommit[]> {
        try {
            const result = await this.exec([
                'log',
                `-${count}`,
                '--pretty=format:%H|%h|%s|%an|%aI'
            ])

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, dateStr] = line.split('|')
                return {
                    hash,
                    shortHash,
                    message,
                    author,
                    date: new Date(dateStr),
                }
            })
        } catch {
            return []
        }
    }

    /**
     * 提交
     */
    async commit(message: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['commit', '-m', message])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 初始化仓库
     */
    async init(): Promise<boolean> {
        try {
            const result = await this.exec(['init'])
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    /**
     * 拉取
     */
    async pull(): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['pull'])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 推送
     */
    async push(): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['push'])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 推送到指定远程和分支
     */
    async pushTo(remote: string, branch: string, setUpstream: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            const args = setUpstream
                ? ['push', '-u', remote, branch]
                : ['push', remote, branch]
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 获取所有分支
     */
    async getBranches(): Promise<{ name: string; current: boolean; remote: boolean; upstream?: string }[]> {
        try {
            const result = await this.exec(['branch', '-a', '-vv'])
            if (result.exitCode !== 0 || !result.stdout) return []

            const branches: { name: string; current: boolean; remote: boolean; upstream?: string }[] = []
            const lines = result.stdout.trim().split('\n').filter(Boolean)

            for (const line of lines) {
                const current = line.startsWith('*')
                const trimmed = line.replace(/^\*?\s+/, '')
                const parts = trimmed.split(/\s+/)
                const name = parts[0]

                // 检查是否是远程分支
                const remote = name.startsWith('remotes/')
                const cleanName = remote ? name.replace('remotes/', '') : name

                // 提取上游分支
                const upstreamMatch = line.match(/\[([^\]]+)\]/)
                const upstream = upstreamMatch ? upstreamMatch[1].split(':')[0] : undefined

                branches.push({ name: cleanName, current, remote, upstream })
            }

            return branches
        } catch {
            return []
        }
    }

    /**
     * 创建分支
     */
    async createBranch(name: string, checkout: boolean = true): Promise<{ success: boolean; error?: string }> {
        try {
            const args = checkout ? ['checkout', '-b', name] : ['branch', name]
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 切换分支
     */
    async checkoutBranch(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['checkout', name])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 删除分支
     */
    async deleteBranch(name: string, force: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            const args = force ? ['branch', '-D', name] : ['branch', '-d', name]
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 合并分支
     */
    async mergeBranch(name: string): Promise<{ success: boolean; error?: string; conflicts?: string[] }> {
        try {
            const result = await this.exec(['merge', name])

            if (result.exitCode !== 0) {
                // 检查是否有冲突
                const statusResult = await this.exec(['status', '--porcelain'])
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
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 获取远程列表
     */
    async getRemotes(): Promise<{ name: string; url: string; type: 'fetch' | 'push' }[]> {
        try {
            const result = await this.exec(['remote', '-v'])
            if (result.exitCode !== 0 || !result.stdout) return []

            const remotes: { name: string; url: string; type: 'fetch' | 'push' }[] = []
            const lines = result.stdout.trim().split('\n').filter(Boolean)

            for (const line of lines) {
                const match = line.match(/^(\\S+)\\s+(\\S+)\\s+\\((fetch|push)\\)$/)
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

    /**
     * 添加远程
     */
    async addRemote(name: string, url: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['remote', 'add', name, url])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 获取 stash 列表
     */
    async getStashList(): Promise<{ index: number; message: string; branch: string }[]> {
        try {
            const result = await this.exec(['stash', 'list'])
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map((line, index) => {
                const match = line.match(/^stash@{(\\d+)}:\\s+(?:On\\s+(\\S+):\\s+)?(.+)$/)
                return {
                    index: match ? parseInt(match[1]) : index,
                    branch: match?.[2] || 'unknown',
                    message: match?.[3] || line,
                }
            })
        } catch {
            return []
        }
    }

    /**
     * 暂存更改
     */
    async stash(message?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message ? ['stash', 'push', '-m', message] : ['stash']
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 应用 stash
     */
    async stashApply(index: number = 0, drop: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            const command = drop ? 'pop' : 'apply'
            const result = await this.exec(['stash', command, `stash@{${index}}`])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 获取文件的 blame 信息
     */
    async blame(filePath: string): Promise<{ line: number; hash: string; author: string; date: Date; content: string }[]> {
        try {
            const result = await this.exec(['blame', '--porcelain', filePath])
            if (result.exitCode !== 0 || !result.stdout) return []

            const lines: { line: number; hash: string; author: string; date: Date; content: string }[] = []
            const chunks = result.stdout.split(/^([a-f0-9]{40})/m).filter(Boolean)

            let lineNum = 0
            for (let i = 0; i < chunks.length; i += 2) {
                const hash = chunks[i]
                const info = chunks[i + 1] || ''

                const authorMatch = info.match(/^author (.+)$/m)
                const timeMatch = info.match(/^author-time (\\d+)$/m)
                const contentMatch = info.match(/^\\t(.*)$/m)

                if (authorMatch && timeMatch && contentMatch) {
                    lineNum++
                    lines.push({
                        line: lineNum,
                        hash: hash.slice(0, 8),
                        author: authorMatch[1],
                        date: new Date(parseInt(timeMatch[1]) * 1000),
                        content: contentMatch[1],
                    })
                }
            }

            return lines
        } catch {
            return []
        }
    }

    /**
     * 获取文件历史
     */
    async getFileHistory(filePath: string, count: number = 20): Promise<GitCommit[]> {
        try {
            const result = await this.exec([
                'log',
                `-${count}`,
                '--pretty=format:%H|%h|%s|%an|%aI',
                '--follow',
                '--',
                filePath
            ])

            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, dateStr] = line.split('|')
                return {
                    hash,
                    shortHash,
                    message,
                    author,
                    date: new Date(dateStr),
                }
            })
        } catch {
            return []
        }
    }

    /**
     * 撤销最后一次提交（保留更改）
     */
    async undoLastCommit(): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--soft', 'HEAD~1'])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 修改最后一次提交
     */
    async amendCommit(message?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message
                ? ['commit', '--amend', '-m', message]
                : ['commit', '--amend', '--no-edit']
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 获取标签列表
     */
    async getTags(): Promise<{ name: string; hash: string; message?: string }[]> {
        try {
            const result = await this.exec(['tag', '-l', '--format=%(refname:short)|%(objectname:short)|%(subject)'])
            if (result.exitCode !== 0 || !result.stdout) return []

            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [name, hash, message] = line.split('|')
                return { name, hash, message: message || undefined }
            })
        } catch {
            return []
        }
    }

    /**
     * 创建标签
     */
    async createTag(name: string, message?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message
                ? ['tag', '-a', name, '-m', message]
                : ['tag', name]
            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * Fetch 远程更新
     */
    async fetch(remote?: string, prune: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            const args = ['fetch']
            if (prune) args.push('--prune')
            if (remote) args.push(remote)

            const result = await this.exec(args)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * Rebase
     */
    async rebase(branch: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', branch])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * 中止 rebase
     */
    async rebaseAbort(): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--abort'])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }

    /**
     * Cherry-pick
     */
    async cherryPick(commitHash: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', commitHash])
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (e: unknown) {
            const err = e as { message?: string }
            return { success: false, error: err.message }
        }
    }
}

export const gitService = new GitService()
