/**
 * @ 提及解析器
 * 解析用户输入中的 @file, @codebase, @web 等提及
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { FileText, Folder, Database, Globe, FileCode, Terminal, GitBranch, AlertCircle, Wrench } from 'lucide-react'
import { skillService } from '@/renderer/agent/services/skillService'

export type MentionType = 'file' | 'folder' | 'codebase' | 'web' | 'git' | 'terminal' | 'symbols' | 'problems' | 'skill'

export interface MentionCandidate {
    id: string
    type: MentionType
    label: string
    description?: string
    icon?: any
    data?: any
    score?: number
}

export interface MentionParseResult {
    trigger: string
    query: string
    range: { start: number; end: number }
}

export const SPECIAL_MENTIONS: MentionCandidate[] = [
    {
        id: 'codebase',
        type: 'codebase',
        label: '@codebase',
        description: 'Search across the entire codebase',
        icon: Database,
    },
    {
        id: 'web',
        type: 'web',
        label: '@web',
        description: 'Search the web',
        icon: Globe,
    },
    {
        id: 'symbols',
        type: 'symbols',
        label: '@symbols',
        description: 'Search symbols in current file',
        icon: FileCode,
    },
    {
        id: 'git',
        type: 'git',
        label: '@git',
        description: 'Reference git changes',
        icon: GitBranch,
    },
    {
        id: 'terminal',
        type: 'terminal',
        label: '@terminal',
        description: 'Reference terminal output',
        icon: Terminal,
    },
    {
        id: 'problems',
        type: 'problems',
        label: '@problems',
        description: 'Reference current file diagnostics/errors',
        icon: AlertCircle,
    },
]

export class MentionParser {
    /**
     * 解析文本中的 @ 提及
     */
    static parse(text: string, cursorPosition: number): MentionParseResult | null {
        const textBeforeCursor = text.slice(0, cursorPosition)
        const lastAt = textBeforeCursor.lastIndexOf('@')

        if (lastAt === -1) return null

        // @ 前必须是空白或行首
        if (lastAt > 0 && !/\s/.test(textBeforeCursor[lastAt - 1])) {
            return null
        }

        const query = textBeforeCursor.slice(lastAt + 1)

        // 查询中不能有空白
        if (/[\s\n]/.test(query)) return null

        return {
            trigger: '@',
            query,
            range: { start: lastAt, end: cursorPosition }
        }
    }

    /**
     * 获取建议列表
     */
    static async getSuggestions(
        query: string,
        workspacePath: string | null,
        options: { includeFiles?: boolean; includeFolders?: boolean } = { includeFiles: true, includeFolders: true }
    ): Promise<MentionCandidate[]> {
        const lowerQuery = query.toLowerCase()
        const suggestions: MentionCandidate[] = []

        // 1. 匹配特殊提及
        SPECIAL_MENTIONS.forEach(m => {
            if (m.label.toLowerCase().includes(lowerQuery) || m.type.includes(lowerQuery)) {
                suggestions.push(m)
            }
        })

        // 2. 匹配已安装的 Skills
        try {
            const skills = await skillService.getSkills()
            const enabledSkills = skills.filter(s => s.enabled)

            for (const skill of enabledSkills) {
                const label = `@${skill.name.toLowerCase()}`
                if (label.includes(lowerQuery)) {
                    suggestions.push({
                        id: `skill-${skill.filePath}`,
                        type: 'skill',
                        label: label,
                        description: skill.description || 'Custom Skill',
                        icon: Wrench,
                        data: {
                            skillId: skill.name.toLowerCase(),
                            name: skill.name
                        }
                    })
                }
            }
        } catch (err) {
            logger.agent.error('Error fetching skills for mention:', err)
        }

        // 3. 搜索文件
        if (workspacePath && (options.includeFiles || options.includeFolders)) {
            try {
                const files = await this.searchFiles(workspacePath, lowerQuery, options)
                suggestions.push(...files)
            } catch (e) {
                logger.agent.error('Error searching files:', e)
            }
        }

        return suggestions
    }

    private static async searchFiles(
        rootPath: string,
        query: string,
        options: { includeFiles?: boolean; includeFolders?: boolean }
    ): Promise<MentionCandidate[]> {
        if (!window.electronAPI) return []

        const candidates: MentionCandidate[] = []

        const collect = async (dir: string, depth: number) => {
            if (depth > 3) return

            const items = await api.file.readDir(dir)
            if (!items) return

            for (const item of items) {
                if (item.name.startsWith('.') && item.name !== '.env') continue
                if (['node_modules', 'dist', 'build', '.git', '.adnify'].includes(item.name)) continue

                const relativePath = item.path.replace(rootPath, '').replace(/^[/\\]/, '')
                const match = item.name.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query)

                if (match) {
                    if (item.isDirectory && options.includeFolders) {
                        candidates.push({
                            id: item.path,
                            type: 'folder',
                            label: item.name,
                            description: relativePath,
                            icon: Folder,
                            data: { path: item.path, relativePath }
                        })
                    } else if (!item.isDirectory && options.includeFiles) {
                        candidates.push({
                            id: item.path,
                            type: 'file',
                            label: item.name,
                            description: relativePath,
                            icon: FileText,
                            data: { path: item.path, relativePath }
                        })
                    }
                }

                if (item.isDirectory && depth < 3) {
                    await collect(item.path, depth + 1)
                }
            }
        }

        await collect(rootPath, 0)

        return candidates
            .sort((a, b) => {
                const aMatch = a.label.toLowerCase() === query
                const bMatch = b.label.toLowerCase() === query
                if (aMatch && !bMatch) return -1
                if (!aMatch && bMatch) return 1
                return a.label.localeCompare(b.label)
            })
            .slice(0, 20)
    }
}