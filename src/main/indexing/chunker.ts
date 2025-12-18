/**
 * 代码分块服务 (Fallback)
 * 当 Tree-sitter 失败时，使用简单的按行分块作为兜底
 */

import * as path from 'path'
import * as crypto from 'crypto'
import { CodeChunk, IndexConfig, DEFAULT_INDEX_CONFIG } from './types'

export class ChunkerService {
  private config: IndexConfig

  constructor(config?: Partial<IndexConfig>) {
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IndexConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 分块单个文件 (Fallback Mode)
   * 仅使用按行分块，不尝试解析语法
   */
  chunkFile(filePath: string, content: string, workspacePath: string): CodeChunk[] {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const relativePath = path.relative(workspacePath, filePath)
    
    // Calculate hash
    const fileHash = crypto.createHash('sha256').update(content).digest('hex')
    
    // 简单的语言推断，仅用于标记
    const language = ext || 'text'

    return this.chunkByLines(filePath, content, workspacePath, language, fileHash)
  }

  /**
   * 按行数分块（带重叠）
   */
  private chunkByLines(
    filePath: string,
    content: string,
    workspacePath: string,
    language: string,
    fileHash: string,
    baseLineNumber: number = 1
  ): CodeChunk[] {
    const lines = content.split('\n')
    const relativePath = path.relative(workspacePath, filePath)
    const chunks: CodeChunk[] = []
    const { chunkSize, chunkOverlap } = this.config

    // 如果文件很小，直接作为一块
    if (lines.length <= chunkSize * 1.5) {
        return [{
            id: this.generateId(filePath, baseLineNumber - 1),
            filePath,
            relativePath,
            fileHash,
            content,
            startLine: baseLineNumber,
            endLine: baseLineNumber + lines.length - 1,
            type: 'file',
            language,
            symbols: [],
        }]
    }

    for (let i = 0; i < lines.length; i += chunkSize - chunkOverlap) {
      const start = i
      const end = Math.min(i + chunkSize, lines.length)
      const chunkContent = lines.slice(start, end).join('\n')

      // 跳过空块
      if (chunkContent.trim().length === 0) continue

      chunks.push({
        id: this.generateId(filePath, baseLineNumber + start - 1),
        filePath,
        relativePath,
        fileHash,
        content: chunkContent,
        startLine: baseLineNumber + start,
        endLine: baseLineNumber + end - 1,
        type: 'block',
        language,
        symbols: [], // Fallback mode doesn't extract symbols
      })

      if (end >= lines.length) break
    }

    return chunks
  }

  /**
   * 生成唯一 ID
   */
  private generateId(filePath: string, lineNumber: number): string {
    return `${filePath}:${lineNumber}`
  }

  /**
   * 检查文件是否应该被索引
   */
  shouldIndexFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return this.config.includedExts.includes(ext)
  }

  /**
   * 检查目录是否应该被忽略
   */
  shouldIgnoreDir(dirName: string): boolean {
    return this.config.ignoredDirs.includes(dirName) || dirName.startsWith('.')
  }
}

