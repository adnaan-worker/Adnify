/**
 * 上下文忽略服务
 * 支持 .adnifyignore 文件，语法兼容 .gitignore
 */

import picomatch from 'picomatch'

// 默认忽略规则
const DEFAULT_IGNORE_PATTERNS = [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'out/**',
    '.next/**',
    '.nuxt/**',
    'coverage/**',
    '.nyc_output/**',
    '*.lock',
    '*.log',
    '.env*',
    '*.min.js',
    '*.min.css',
    '*.map',
    '.DS_Store',
    'Thumbs.db',
    '*.pyc',
    '__pycache__/**',
    '.vscode/**',
    '.idea/**',
    '*.swp',
    '*.swo',
]

class IgnoreServiceClass {
    private patterns: string[] = []
    private matcher: picomatch.Matcher | null = null
    private workspacePath: string | null = null

    /**
     * 加载忽略文件
     * 优先级: .adnifyignore > .cursorignore > .gitignore (仅作为参考)
     */
    async loadIgnoreFile(workspacePath: string): Promise<void> {
        // 如果已经加载了相同工作区，跳过
        if (this.workspacePath === workspacePath && this.matcher) {
            return
        }

        this.workspacePath = workspacePath
        const ignoreFiles = ['.adnifyignore', '.cursorignore']

        for (const fileName of ignoreFiles) {
            const ignorePath = `${workspacePath}/${fileName}`
            try {
                const content = await window.electronAPI.readFile(ignorePath)
                if (content) {
                    this.parsePatterns(content)
                    console.log(`[IgnoreService] Loaded ${fileName} with ${this.patterns.length} patterns`)
                    return
                }
            } catch {
                // 文件不存在，继续尝试下一个
            }
        }

        // 使用默认规则
        this.patterns = [...DEFAULT_IGNORE_PATTERNS]
        this.matcher = picomatch(this.patterns, { dot: true, basename: true })
        console.log('[IgnoreService] Using default patterns')
    }

    /**
     * 解析忽略规则内容
     */
    private parsePatterns(content: string): void {
        this.patterns = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            // 合并默认规则
            .concat(DEFAULT_IGNORE_PATTERNS)

        // 去重
        this.patterns = [...new Set(this.patterns)]

        this.matcher = picomatch(this.patterns, { dot: true, basename: true })
    }

    /**
     * 检查路径是否应该被忽略
     */
    isIgnored(filePath: string): boolean {
        if (!this.matcher) return false

        // 标准化路径
        const normalizedPath = filePath.replace(/\\/g, '/')

        // 如果有工作区路径，使用相对路径
        if (this.workspacePath) {
            const normalizedWorkspace = this.workspacePath.replace(/\\/g, '/')
            if (normalizedPath.startsWith(normalizedWorkspace)) {
                const relativePath = normalizedPath.slice(normalizedWorkspace.length + 1)
                return this.matcher(relativePath)
            }
        }

        return this.matcher(normalizedPath)
    }

    /**
     * 获取当前的忽略规则
     */
    getPatterns(): string[] {
        return [...this.patterns]
    }

    /**
     * 添加临时忽略规则（不持久化）
     */
    addPattern(pattern: string): void {
        if (!this.patterns.includes(pattern)) {
            this.patterns.push(pattern)
            this.matcher = picomatch(this.patterns, { dot: true, basename: true })
        }
    }

    /**
     * 移除忽略规则
     */
    removePattern(pattern: string): void {
        this.patterns = this.patterns.filter(p => p !== pattern)
        this.matcher = picomatch(this.patterns, { dot: true, basename: true })
    }

    /**
     * 重置为默认规则
     */
    reset(): void {
        this.patterns = [...DEFAULT_IGNORE_PATTERNS]
        this.matcher = picomatch(this.patterns, { dot: true, basename: true })
        this.workspacePath = null
    }

    /**
     * 过滤文件列表，返回未被忽略的文件
     */
    filterFiles<T extends { path?: string; uri?: string }>(files: T[]): T[] {
        return files.filter(file => {
            const path = file.path || file.uri
            return path ? !this.isIgnored(path) : true
        })
    }
}

// 导出单例
export const ignoreService = new IgnoreServiceClass()

// 导出类型
export type { IgnoreServiceClass }
