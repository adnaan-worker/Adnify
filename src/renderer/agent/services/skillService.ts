/**
 * Skill 服务
 * 
 * 基于 agentskills.io 标准实现 Skill 系统
 * 扫描 .adnify/skills/ 目录下的 SKILL.md 文件
 * 支持从 skills.sh 市场安装和 GitHub 克隆安装
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'

// ============================================
// 类型定义
// ============================================

export interface SkillItem {
    name: string
    description: string
    content: string       // SKILL.md body（去掉 frontmatter）
    filePath: string
    enabled: boolean
    license?: string
    metadata?: Record<string, string>
}

interface SkillConfig {
    disabled: string[]    // 禁用的 Skill 名称列表
}

interface MarketplaceResult {
    name: string
    package: string       // owner/repo@skill-name
    installs: number
    url: string
}

// ============================================
// YAML Frontmatter 解析
// ============================================

function parseSkillMd(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
    const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
    if (!match) return null

    const frontmatterRaw = match[1]
    const body = match[2].trim()

    // 简单 YAML 解析（支持 name, description, license, metadata 等）
    const frontmatter: Record<string, unknown> = {}
    let currentKey = ''
    let inMetadata = false
    const metadataObj: Record<string, string> = {}

    for (const line of frontmatterRaw.split('\n')) {
        const trimmed = line.trimEnd()

        // metadata 子键
        if (inMetadata && trimmed.match(/^\s{2,}\S/)) {
            const subMatch = trimmed.match(/^\s+(\S+)\s*:\s*(.*)$/)
            if (subMatch) {
                metadataObj[subMatch[1]] = subMatch[2].replace(/^["']|["']$/g, '').trim()
            }
            continue
        } else if (inMetadata) {
            inMetadata = false
            frontmatter['metadata'] = metadataObj
        }

        // 顶级键
        const kvMatch = trimmed.match(/^(\S+)\s*:\s*(.*)$/)
        if (kvMatch) {
            currentKey = kvMatch[1]
            const value = kvMatch[2].replace(/^["']|["']$/g, '').trim()

            if (currentKey === 'metadata' && !value) {
                inMetadata = true
                continue
            }

            frontmatter[currentKey] = value
        }
    }

    if (inMetadata) {
        frontmatter['metadata'] = metadataObj
    }

    return { frontmatter, body }
}

// ============================================
// Skill 服务
// ============================================

class SkillService {
    private cache: SkillItem[] | null = null
    private configCache: SkillConfig | null = null
    private lastScanTime = 0
    private readonly SCAN_INTERVAL = 5000 // 5 秒缓存
    private readonly SKILLS_DIR = '.adnify/skills'
    private readonly CONFIG_FILE = '.adnify/skills/.config.json'

    /**
     * 获取所有已启用的 Skills
     */
    async getSkills(): Promise<SkillItem[]> {
        const all = await this.getAllSkills()
        return all.filter(s => s.enabled)
    }

    /**
     * 获取所有 Skills（包括禁用的）
     */
    async getAllSkills(forceRefresh = false): Promise<SkillItem[]> {
        const now = Date.now()
        if (!forceRefresh && this.cache && (now - this.lastScanTime) < this.SCAN_INTERVAL) {
            return this.cache
        }

        const { workspacePath } = useStore.getState()
        if (!workspacePath) return []

        const skillsDir = joinPath(workspacePath, this.SKILLS_DIR)
        const items = await api.file.readDir(skillsDir)
        if (!items) return []

        const config = await this.loadConfig()
        const skills: SkillItem[] = []

        for (const item of items) {
            if (!item.isDirectory || item.name.startsWith('.')) continue

            const skillMdPath = joinPath(skillsDir, item.name, 'SKILL.md')
            const raw = await api.file.read(skillMdPath)
            if (!raw) continue

            const parsed = parseSkillMd(raw)
            if (!parsed) {
                logger.agent.warn(`[SkillService] Invalid SKILL.md format: ${item.name}`)
                continue
            }

            const { frontmatter, body } = parsed
            const name = (frontmatter.name as string) || item.name
            const description = (frontmatter.description as string) || ''

            if (!name || !description) {
                logger.agent.warn(`[SkillService] Missing name or description: ${item.name}`)
                continue
            }

            skills.push({
                name,
                description,
                content: body,
                filePath: skillMdPath,
                enabled: !config.disabled.includes(name),
                license: frontmatter.license as string | undefined,
                metadata: frontmatter.metadata as Record<string, string> | undefined,
            })
        }

        this.cache = skills
        this.lastScanTime = now
        logger.agent.info(`[SkillService] Loaded ${skills.length} skills`)
        return skills
    }

    /**
     * 从 skills.sh 市场搜索 Skills（使用 REST API）
     */
    async searchMarketplace(query: string): Promise<MarketplaceResult[]> {
        try {
            const result = await api.http.readUrl(
                `https://skills.sh/api/search?q=${encodeURIComponent(query)}`,
                15000
            )

            if (!result.success || !result.content) return []

            const data = JSON.parse(result.content) as {
                skills?: Array<{
                    name: string
                    source: string
                    installs: number
                    skillId: string
                }>
            }

            if (!data.skills?.length) return []

            return data.skills.map(s => ({
                name: s.name,
                package: `${s.source}@${s.skillId}`,
                installs: s.installs,
                url: `https://skills.sh/${s.source}/${s.skillId}`,
            }))
        } catch (err) {
            logger.agent.error('[SkillService] Marketplace search failed:', err)
            return []
        }
    }

    /**
     * 从 skills.sh 安装 Skill（GitHub API 递归下载）
     * 解析 packageId (owner/repo@skillId)，通过 GitHub Contents API 下载完整 skill 目录
     */
    async installFromMarketplace(packageId: string): Promise<{ success: boolean; error?: string }> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return { success: false, error: 'No workspace open' }

        // 解析 owner/repo@skillId
        const atIdx = packageId.indexOf('@')
        if (atIdx === -1) return { success: false, error: 'Invalid package format' }
        const repo = packageId.substring(0, atIdx)
        const skillId = packageId.substring(atIdx + 1)
        if (!repo || !skillId) return { success: false, error: 'Invalid package format' }

        const skillsDir = joinPath(workspacePath, this.SKILLS_DIR)
        await api.file.mkdir(skillsDir)
        const targetDir = joinPath(skillsDir, skillId)

        try {
            // 1. 在 GitHub 仓库中定位 skill 目录（尝试多种已知结构）
            const candidateDirs = [
                `.claude/skills/${skillId}`,
                `skills/${skillId}`,
                skillId,
                '',
            ]

            let skillDirPath: string | null = null
            let branch = 'main'

            for (const dir of candidateDirs) {
                for (const b of ['main', 'master']) {
                    const apiUrl = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${b}`
                    const result = await api.http.readUrl(apiUrl, 10000)
                    if (result.success && result.content) {
                        try {
                            const items = JSON.parse(result.content)
                            if (Array.isArray(items) && items.some((f: { name: string }) => f.name === 'SKILL.md')) {
                                skillDirPath = dir
                                branch = b
                                break
                            }
                        } catch { /* parse error, try next */ }
                    }
                }
                if (skillDirPath !== null) break
            }

            if (skillDirPath === null) {
                return { success: false, error: `Could not find SKILL.md in ${repo}` }
            }

            logger.agent.info(`[SkillService] Found skill at ${repo}/${skillDirPath} (${branch})`)

            // 2. 递归下载整个 skill 目录
            await api.file.mkdir(targetDir)
            await this.downloadGitHubDir(repo, branch, skillDirPath, targetDir)

            // 3. 验证
            const verifyContent = await api.file.read(joinPath(targetDir, 'SKILL.md'))
            if (!verifyContent) {
                await api.file.delete(targetDir)
                return { success: false, error: 'Download verification failed' }
            }

            this.clearCache()
            return { success: true }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { success: false, error: msg }
        }
    }

    /**
     * 递归下载 GitHub 目录下所有文件
     */
    private async downloadGitHubDir(repo: string, branch: string, remotePath: string, localDir: string): Promise<void> {
        const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}?ref=${branch}`
        const result = await api.http.readUrl(apiUrl, 10000)
        if (!result.success || !result.content) return

        let items: Array<{ name: string; type: string; download_url: string | null; path: string }>
        try {
            items = JSON.parse(result.content)
        } catch { return }

        if (!Array.isArray(items)) return

        for (const item of items) {
            if (item.name.startsWith('.')) continue  // 跳过隐藏文件
            const localPath = joinPath(localDir, item.name)

            if (item.type === 'file' && item.download_url) {
                const fileResult = await api.http.readUrl(item.download_url, 15000)
                if (fileResult.success && fileResult.content) {
                    await api.file.write(localPath, fileResult.content)
                }
            } else if (item.type === 'dir') {
                await api.file.mkdir(localPath)
                await this.downloadGitHubDir(repo, branch, item.path, localPath)
            } else if (item.type === 'symlink' && item.download_url) {
                // 符号链接：读取目标路径，解析后下载实际内容
                const linkResult = await api.http.readUrl(item.download_url, 10000)
                if (!linkResult.success || !linkResult.content) continue

                // 链接目标是相对路径（如 "../../../.shared/data"）
                // 解析为仓库内的绝对路径
                const linkTarget = linkResult.content.trim()
                const parentDir = item.path.split('/').slice(0, -1).join('/')
                const resolvedPath = this.resolveRelativePath(parentDir, linkTarget)

                // 尝试作为目录下载
                const targetApiUrl = `https://api.github.com/repos/${repo}/contents/${resolvedPath}?ref=${branch}`
                const targetResult = await api.http.readUrl(targetApiUrl, 10000)
                if (targetResult.success && targetResult.content) {
                    try {
                        const targetItems = JSON.parse(targetResult.content)
                        if (Array.isArray(targetItems)) {
                            // 是目录，递归下载
                            await api.file.mkdir(localPath)
                            await this.downloadGitHubDir(repo, branch, resolvedPath, localPath)
                        } else if (targetItems.download_url) {
                            // 是文件
                            const fileResult = await api.http.readUrl(targetItems.download_url, 15000)
                            if (fileResult.success && fileResult.content) {
                                await api.file.write(localPath, fileResult.content)
                            }
                        }
                    } catch { /* parse error */ }
                }
            }
        }
    }

    /**
     * 解析相对路径（处理 ../ 等）
     */
    private resolveRelativePath(basePath: string, relativePath: string): string {
        const baseParts = basePath.split('/').filter(Boolean)
        const relParts = relativePath.split('/').filter(Boolean)

        for (const part of relParts) {
            if (part === '..') {
                baseParts.pop()
            } else if (part !== '.') {
                baseParts.push(part)
            }
        }

        return baseParts.join('/')
    }

    /**
     * 从 GitHub URL 安装 Skill
     */
    async installFromGitHub(url: string): Promise<{ success: boolean; error?: string }> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return { success: false, error: 'No workspace open' }

        // 从 URL 提取仓库名作为 skill 目录名
        const repoName = url.replace(/\.git$/, '').split('/').pop()
        if (!repoName) return { success: false, error: 'Invalid GitHub URL' }

        const skillsDir = joinPath(workspacePath, this.SKILLS_DIR)
        await api.file.mkdir(skillsDir)

        const targetDir = joinPath(skillsDir, repoName)

        try {
            const result = await api.shell.executeBackground({
                command: `git clone --depth 1 "${url}" "${targetDir}"`,
                cwd: workspacePath,
                timeout: 60000,
            })

            if (result.exitCode !== 0 && result.error) {
                return { success: false, error: result.error || result.output }
            }

            // 验证 SKILL.md 存在
            const skillMd = await api.file.read(joinPath(targetDir, 'SKILL.md'))
            if (!skillMd) {
                // 检查是否是包含多个 skill 的仓库
                const items = await api.file.readDir(targetDir)
                const hasSubSkills = items?.some(i => i.isDirectory)
                if (!hasSubSkills) {
                    await api.file.delete(targetDir)
                    return { success: false, error: 'No SKILL.md found in repository' }
                }
            }

            this.clearCache()
            return { success: true }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { success: false, error: msg }
        }
    }

    /**
     * 创建新 Skill
     */
    async createSkill(name: string, description = ''): Promise<{ success: boolean; filePath?: string; error?: string }> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return { success: false, error: 'No workspace open' }

        // 验证名称格式
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
            return { success: false, error: 'Name must be lowercase alphanumeric with hyphens (e.g. my-skill)' }
        }

        const skillDir = joinPath(workspacePath, this.SKILLS_DIR, name)
        const skillMdPath = joinPath(skillDir, 'SKILL.md')

        // 检查是否已存在
        const existing = await api.file.read(skillMdPath)
        if (existing !== null) {
            return { success: false, error: `Skill "${name}" already exists` }
        }

        await api.file.mkdir(skillDir)

        const template = `---
name: ${name}
description: ${description || 'Describe what this skill does and when to use it.'}
---

## Instructions

Add your skill instructions here.
`

        const success = await api.file.write(skillMdPath, template)
        if (!success) return { success: false, error: 'Failed to write SKILL.md' }

        this.clearCache()
        return { success: true, filePath: skillMdPath }
    }

    /**
     * 删除 Skill
     */
    async deleteSkill(name: string): Promise<boolean> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return false

        const skillDir = joinPath(workspacePath, this.SKILLS_DIR, name)
        const success = await api.file.delete(skillDir)

        if (success) {
            // 从禁用列表中也移除
            const config = await this.loadConfig()
            config.disabled = config.disabled.filter(n => n !== name)
            await this.saveConfig(config)
            this.clearCache()
        }

        return success
    }

    /**
     * 切换 Skill 启用/禁用
     */
    async toggleSkill(name: string, enabled: boolean): Promise<boolean> {
        const config = await this.loadConfig()

        if (enabled) {
            config.disabled = config.disabled.filter(n => n !== name)
        } else {
            if (!config.disabled.includes(name)) {
                config.disabled.push(name)
            }
        }

        await this.saveConfig(config)

        // 更新缓存
        if (this.cache) {
            const skill = this.cache.find(s => s.name === name)
            if (skill) skill.enabled = enabled
        }

        return true
    }

    /**
     * 构建 Skills prompt section
     */
    buildSkillsPrompt(skills: SkillItem[]): string {
        const enabled = skills.filter(s => s.enabled)
        if (enabled.length === 0) return ''

        const sections = enabled.map(s =>
            `<skill name="${s.name}">\n${s.description}\n\n${s.content}\n</skill>`
        ).join('\n\n')

        return `## Skills
You have access to the following project-specific skills. Follow their instructions when the task is relevant.

${sections}`
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cache = null
        this.configCache = null
        this.lastScanTime = 0
    }

    // ============================================
    // 配置管理
    // ============================================

    private async loadConfig(): Promise<SkillConfig> {
        if (this.configCache) return this.configCache

        const { workspacePath } = useStore.getState()
        if (!workspacePath) return { disabled: [] }

        const configPath = joinPath(workspacePath, this.CONFIG_FILE)
        const content = await api.file.read(configPath)

        if (!content) return { disabled: [] }

        try {
            const config = JSON.parse(content) as SkillConfig
            this.configCache = config
            return config
        } catch {
            return { disabled: [] }
        }
    }

    private async saveConfig(config: SkillConfig): Promise<void> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return

        this.configCache = config

        const skillsDir = joinPath(workspacePath, this.SKILLS_DIR)
        await api.file.mkdir(skillsDir)

        const configPath = joinPath(workspacePath, this.CONFIG_FILE)
        await api.file.write(configPath, JSON.stringify(config, null, 2))
    }
}

export const skillService = new SkillService()
