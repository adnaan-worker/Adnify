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
import { joinPath, platform } from '@shared/utils/pathUtils'
import { parse as parseYaml } from 'yaml'

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

    let frontmatter: Record<string, unknown> = {}
    try {
        frontmatter = parseYaml(frontmatterRaw) || {}
    } catch (e) {
        logger.agent.warn('[SkillService] Failed to parse YAML frontmatter:', e)
        return null
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
    private readonly CONFIG_FILE = '.adnify/skills/.skills-config.json'

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
     * 从 skills.sh 安装 Skill（标准 Claude Code 流程）
     * 1. 克隆仓库到临时目录
     * 2. 在仓库中找到包含 SKILL.md 的技能目录
     * 3. 仅提取该技能目录（解引用符号链接为真实文件）到 .adnify/skills/[skillId]
     * 4. 清理临时克隆
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
        const tmpDir = joinPath(skillsDir, `.tmp-clone-${skillId}-${Date.now()}`)

        try {
            // 1. 克隆仓库到临时目录
            const url = `https://github.com/${repo}.git`
            const cloneResult = await api.shell.executeBackground({
                command: `git clone -c core.symlinks=true --depth 1 "${url}" "${tmpDir}"`,
                cwd: workspacePath,
                timeout: 60000,
            })

            if (cloneResult.exitCode !== 0 && cloneResult.error) {
                await api.file.delete(tmpDir)
                return { success: false, error: cloneResult.error || cloneResult.output }
            }

            // 2. 在仓库中定位包含 SKILL.md 的技能目录
            const candidateDirs = [
                `.claude/skills/${skillId}`,
                `skills/${skillId}`,
                skillId,
                '',
            ]

            let foundDir: string | null = null
            for (const dir of candidateDirs) {
                const checkPath = joinPath(tmpDir, dir, 'SKILL.md')
                const exists = await api.file.exists(checkPath)
                if (exists) {
                    foundDir = dir ? joinPath(tmpDir, dir) : tmpDir
                    break
                }
            }

            if (!foundDir) {
                await api.file.delete(tmpDir)
                return { success: false, error: `Could not find SKILL.md in cloned repository ${repo}` }
            }

            // 3. 仅提取技能目录到 targetDir（解引用符号链接为真实文件）
            await api.file.delete(targetDir)
            if (foundDir === tmpDir) {
                // SKILL.md 在仓库根目录，直接移动（删掉 .git 文件夹节省空间）
                await api.file.delete(joinPath(tmpDir, '.git'))
                await api.file.rename(tmpDir, targetDir)
            } else {
                // SKILL.md 在子目录，解引用符号链接复制该子目录
                await api.file.mkdir(targetDir)
                const copyCommand = platform.isWindows
                    ? `robocopy "${foundDir}" "${targetDir}" /E /NFL /NDL /NJH /NJS /NP`
                    : `cp -rL "${foundDir}/." "${targetDir}"`
                const copyResult = await api.shell.executeBackground({
                    command: copyCommand,
                    cwd: workspacePath,
                    timeout: 30000,
                })
                const copyFailed = platform.isWindows
                    ? (copyResult.exitCode !== undefined && copyResult.exitCode >= 8)
                    : (copyResult.exitCode !== 0)
                if (copyFailed) {
                    await api.file.delete(targetDir)
                    await api.file.delete(tmpDir)
                    return { success: false, error: `Failed to copy skill directory: ${copyResult.error || copyResult.output}` }
                }
                // 清理临时克隆
                await api.file.delete(tmpDir)
            }

            this.clearCache()
            return { success: true }
        } catch (err) {
            await api.file.delete(tmpDir)
            const msg = err instanceof Error ? err.message : String(err)
            return { success: false, error: msg }
        }
    }

    /**
     * 从 GitHub URL 安装 Skill（标准 Claude Code 流程）
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
        const tmpDir = joinPath(skillsDir, `.tmp-clone-${repoName}-${Date.now()}`)

        try {
            // 1. 克隆仓库到临时目录
            const result = await api.shell.executeBackground({
                command: `git clone -c core.symlinks=true --depth 1 "${url}" "${tmpDir}"`,
                cwd: workspacePath,
                timeout: 60000,
            })

            if (result.exitCode !== 0 && result.error) {
                await api.file.delete(tmpDir)
                return { success: false, error: result.error || result.output }
            }

            // 2. 在仓库中定位包含 SKILL.md 的技能目录
            const candidateDirs = [
                `.claude/skills/${repoName}`,
                `skills/${repoName}`,
                repoName,
                '',
            ]

            let foundDir: string | null = null
            for (const dir of candidateDirs) {
                const checkPath = joinPath(tmpDir, dir, 'SKILL.md')
                const exists = await api.file.exists(checkPath)
                if (exists) {
                    foundDir = dir ? joinPath(tmpDir, dir) : tmpDir
                    break
                }
            }

            if (!foundDir) {
                await api.file.delete(tmpDir)
                return { success: false, error: 'No SKILL.md found in repository' }
            }

            // 3. 仅提取技能目录到 targetDir（解引用符号链接为真实文件）
            await api.file.delete(targetDir)
            if (foundDir === tmpDir) {
                // SKILL.md 在仓库根目录，直接移动（删掉 .git 文件夹节省空间）
                await api.file.delete(joinPath(tmpDir, '.git'))
                await api.file.rename(tmpDir, targetDir)
            } else {
                // SKILL.md 在子目录，解引用符号链接复制该子目录
                await api.file.mkdir(targetDir)
                const copyCommand = platform.isWindows
                    ? `robocopy "${foundDir}" "${targetDir}" /E /NFL /NDL /NJH /NJS /NP`
                    : `cp -rL "${foundDir}/." "${targetDir}"`
                const copyResult = await api.shell.executeBackground({
                    command: copyCommand,
                    cwd: workspacePath,
                    timeout: 30000,
                })
                const copyFailed = platform.isWindows
                    ? (copyResult.exitCode !== undefined && copyResult.exitCode >= 8)
                    : (copyResult.exitCode !== 0)
                if (copyFailed) {
                    await api.file.delete(targetDir)
                    await api.file.delete(tmpDir)
                    return { success: false, error: `Failed to copy skill directory: ${copyResult.error || copyResult.output}` }
                }
                await api.file.delete(tmpDir)
            }

            this.clearCache()
            return { success: true }
        } catch (err) {
            await api.file.delete(tmpDir)
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

        const sections = enabled.map(s => {
            // 防注入安全：转义 </skill> 标签
            const safeContent = s.content.replace(/<\/skill>/gi, '<\\/skill>')
            const installPath = `${this.SKILLS_DIR}/${s.name}/`
            return `<skill name="${s.name}" path="${installPath}">\n${s.description}\n\n${safeContent}\n</skill>`
        }).join('\n\n')

        return `## Skills
The following project-specific skills are available. 

### Usage Guidelines
- **Path Awareness**: Each skill's installation path is provided in its \`path\` attribute. If a skill's instructions mention a path like "skills/..." or ".claude/skills/...", map it to the actual installation path.
- **Environment Adaptation**: Adapt commands (e.g., shell syntax, executable names like "python" vs "python3") to your current environment (Windows).
- **Tool Integration**: Use the provided tools (shell, file, etc.) to execute these skills as instructed.

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
