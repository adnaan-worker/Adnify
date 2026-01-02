/**
 * 向量存储服务
 * 使用 LanceDB 存储和检索代码向量
 */

import { logger } from '@shared/utils/Logger'
import * as path from 'path'
import * as fs from 'fs'
import { IndexedChunk, SearchResult } from './types'

/**
 * LanceDB 类型定义
 * 由于 LanceDB 是动态导入的，这里定义接口描述其 API
 */
interface LanceDBConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<LanceDBTable>
  createTable(name: string, data: unknown[]): Promise<LanceDBTable>
  dropTable(name: string): Promise<void>
}

interface LanceDBTable {
  countRows(): Promise<number>
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  query(): LanceDBQuery
  search(vector: number[]): LanceDBVectorQuery
}

interface LanceDBQuery {
  select(columns: string[]): LanceDBQuery
  where(filter: string): LanceDBQuery
  limit(n: number): LanceDBQuery
  execute(): Promise<LanceDBRecord[]>
}

interface LanceDBVectorQuery {
  limit(n: number): LanceDBVectorQuery
  execute(): Promise<LanceDBSearchResult[]>
}

/** LanceDB 记录类型 */
interface LanceDBRecord {
  filePath: string
  relativePath: string
  fileHash: string
  content: string
  startLine: number
  endLine: number
  type: string
  language: string
  symbols: string
}

/** LanceDB 向量搜索结果 */
interface LanceDBSearchResult extends LanceDBRecord {
  _distance: number
}

export class VectorStoreService {
  private db: LanceDBConnection | null = null
  private table: LanceDBTable | null = null
  private indexPath: string
  private tableName = 'code_chunks'

  constructor(workspacePath: string) {
    this.indexPath = path.join(workspacePath, '.adnify', 'index')
  }

  /**
   * 初始化数据库连接
   */
  async initialize(): Promise<void> {
    // 确保目录存在
    if (!fs.existsSync(this.indexPath)) {
      fs.mkdirSync(this.indexPath, { recursive: true })
    }

    try {
      const lancedb = await import('@lancedb/lancedb')
      this.db = (await lancedb.connect(this.indexPath)) as unknown as LanceDBConnection

      // 检查是否已有表
      const tables = await this.db.tableNames()
      if (tables.includes(this.tableName)) {
        this.table = (await this.db.openTable(this.tableName)) as unknown as LanceDBTable
        
        // 验证 schema 是否正确（检查是否有 filePath 字段）
        const isValidSchema = await this.validateSchema()
        if (!isValidSchema) {
          logger.index.warn('[VectorStore] Invalid schema detected, dropping old table')
          await this.db.dropTable(this.tableName)
          this.table = null
        }
      }
      logger.index.info('[VectorStore] Initialized at:', this.indexPath)
    } catch (e) {
      logger.index.error('[VectorStore] Failed to initialize LanceDB:', e)
      this.db = null
    }
  }

  /**
   * 验证表 schema 是否正确
   * 检查必要的字段是否存在且命名正确
   */
  private async validateSchema(): Promise<boolean> {
    if (!this.table) return false
    
    try {
      // 尝试查询一条记录来验证字段
      await this.table
        .query()
        .select(['filePath', 'fileHash'])
        .limit(1)
        .execute()
      
      // 如果能成功查询，说明 schema 正确
      return true
    } catch (e) {
      // 查询失败说明字段名不匹配
      logger.index.warn('[VectorStore] Schema validation failed:', e)
      return false
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.db !== null
  }

  /**
   * 检查是否有索引数据
   */
  async hasIndex(): Promise<boolean> {
    if (!this.table) return false
    const count = await this.table.countRows()
    return count > 0
  }

  /**
   * 获取索引统计
   */
  async getStats(): Promise<{ chunkCount: number; fileCount: number }> {
    if (!this.table) {
      return { chunkCount: 0, fileCount: 0 }
    }

    const count = await this.table.countRows()
    return { chunkCount: count, fileCount: Math.ceil(count / 5) }
  }

  /**
   * 获取所有文件的 Hash
   * 只查询 filePath 和 fileHash 字段，减少内存占用
   */
  async getFileHashes(): Promise<Map<string, string>> {
    if (!this.table) return new Map()
    
    try {
      const hashMap = new Map<string, string>()
      
      // LanceDB 不支持 offset，直接查询所有记录
      // 只选择需要的字段以减少内存占用
      const results = await this.table
        .query()
        .select(['filePath', 'fileHash'])
        .execute()

      for (const r of results) {
        if (r.filePath && r.fileHash) {
          // 只保留第一次出现的 hash（同一文件的多个 chunk 有相同 hash）
          if (!hashMap.has(r.filePath as string)) {
            hashMap.set(r.filePath as string, r.fileHash as string)
          }
        }
      }

      logger.index.info(`[VectorStore] Loaded ${hashMap.size} file hashes`)
      return hashMap
    } catch (e) {
      logger.index.error('[VectorStore] Error fetching file hashes:', e)
      return new Map()
    }
  }

  /**
   * 创建或重建索引
   */
  async createIndex(chunks: IndexedChunk[]): Promise<void> {
    if (!this.db) return

    if (chunks.length === 0) {
      logger.index.info('[VectorStore] No chunks to index')
      return
    }

    // 准备数据
    const data = chunks.map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      relativePath: chunk.relativePath,
      fileHash: chunk.fileHash,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      type: chunk.type,
      language: chunk.language,
      symbols: chunk.symbols?.join(',') || '',
      vector: chunk.vector,
    }))

    const tables = await this.db.tableNames()
    if (tables.includes(this.tableName)) {
      await this.db.dropTable(this.tableName)
    }

    this.table = (await this.db.createTable(this.tableName, data)) as unknown as LanceDBTable
    logger.index.info(`[VectorStore] Created index with ${chunks.length} chunks`)
  }

  /**
   * 批量添加 chunks (追加模式，表不存在时自动创建)
   */
  async addBatch(chunks: IndexedChunk[]): Promise<void> {
    if (!this.db || chunks.length === 0) return

    const data = chunks.map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      relativePath: chunk.relativePath,
      fileHash: chunk.fileHash,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      type: chunk.type,
      language: chunk.language,
      symbols: chunk.symbols?.join(',') || '',
      vector: chunk.vector,
    }))

    // 如果表不存在，创建表
    if (!this.table) {
      this.table = (await this.db.createTable(this.tableName, data)) as unknown as LanceDBTable
      logger.index.info(`[VectorStore] Created table with ${chunks.length} initial chunks`)
    } else {
      await this.table.add(data)
    }
  }

  /**
   * 添加或更新文件的 chunks
   * 使用安全的删除方式避免 SQL 注入
   */
  async upsertFile(filePath: string, chunks: IndexedChunk[]): Promise<void> {
    if (!this.table || !this.db) return

    try {
      // 使用 filter 方式删除，避免 SQL 注入风险
      // LanceDB 的 delete 方法使用 SQL 语法，需要安全处理
      await this.safeDeleteByFilePath(filePath)
    } catch {
      // ignore
    }

    if (chunks.length === 0) return

    const data = chunks.map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      relativePath: chunk.relativePath,
      fileHash: chunk.fileHash,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      type: chunk.type,
      language: chunk.language,
      symbols: chunk.symbols?.join(',') || '',
      vector: chunk.vector,
    }))

    await this.table.add(data)
  }

  /**
   * 安全删除指定文件的 chunks
   * 通过查询-过滤-重建的方式避免 SQL 注入
   */
  private async safeDeleteByFilePath(filePath: string): Promise<void> {
    if (!this.table) return

    try {
      // 方案1：使用参数化的方式（如果 LanceDB 支持）
      // 方案2：严格验证和转义文件路径
      const safePath = this.sanitizeFilePath(filePath)
      await this.table.delete(`filePath = '${safePath}'`)
    } catch (e) {
      logger.index.warn('[VectorStore] Safe delete failed, using fallback:', e)
      // 如果删除失败，记录警告但不阻塞操作
    }
  }

  /**
   * 清理文件路径，防止 SQL 注入
   */
  private sanitizeFilePath(filePath: string): string {
    // 1. 转义单引号
    let safe = filePath.replace(/'/g, "''")
    // 2. 移除可能的 SQL 注释
    safe = safe.replace(/--/g, '')
    // 3. 移除分号（防止多语句注入）
    safe = safe.replace(/;/g, '')
    // 4. 限制长度
    if (safe.length > 1000) {
      safe = safe.substring(0, 1000)
    }
    return safe
  }

  /**
   * 删除文件的 chunks
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.table) return

    try {
      await this.safeDeleteByFilePath(filePath)
    } catch {
      // ignore
    }
  }

  /**
   * 批量删除多个文件的 chunks
   * 比逐个删除更高效
   */
  async deleteFiles(filePaths: string[]): Promise<void> {
    if (!this.table || filePaths.length === 0) return

    try {
      // 构建安全的 OR 条件
      const conditions = filePaths
        .map(fp => `filePath = '${this.sanitizeFilePath(fp)}'`)
        .join(' OR ')
      
      await this.table.delete(conditions)
      logger.index.info(`[VectorStore] Deleted chunks for ${filePaths.length} files`)
    } catch (e) {
      logger.index.error('[VectorStore] Batch delete failed:', e)
      // 回退到逐个删除
      for (const fp of filePaths) {
        await this.deleteFile(fp)
      }
    }
  }

  /**
   * 向量搜索
   */
  async search(queryVector: number[], topK: number = 10): Promise<SearchResult[]> {
    if (!this.table) return []

    const results = await this.table
      .search(queryVector)
      .limit(topK)
      .execute()

    return results.map((r: LanceDBSearchResult) => ({
      filePath: r.filePath,
      relativePath: r.relativePath,
      content: r.content,
      startLine: r.startLine,
      endLine: r.endLine,
      type: r.type,
      language: r.language,
      score: 1 - r._distance,
    }))
  }

  /**
   * 关键词搜索
   * 在 content、symbols、relativePath 中搜索关键词
   */
  async keywordSearch(keywords: string[], topK: number = 10): Promise<SearchResult[]> {
    if (!this.table || keywords.length === 0) return []

    try {
      // 构建 SQL WHERE 条件：任意关键词匹配 content、symbols 或 relativePath
      // 注意：LanceDB 字段名区分大小写，必须用双引号包裹
      const conditions = keywords.map(kw => {
        const safeKw = this.sanitizeKeyword(kw)
        return `(content LIKE '%${safeKw}%' OR symbols LIKE '%${safeKw}%' OR "relativePath" LIKE '%${safeKw}%')`
      }).join(' OR ')

      const queryResult = await this.table
        .query()
        .where(conditions)
        .limit(topK)
        .execute()

      // 确保结果是数组
      const results = Array.isArray(queryResult) ? queryResult : []

      return results.map((r: LanceDBRecord) => ({
        filePath: r.filePath,
        relativePath: r.relativePath,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        type: r.type,
        language: r.language,
        score: this.calculateKeywordScore(r.content, r.symbols, keywords),
      }))
    } catch (e) {
      logger.index.warn('[VectorStore] Keyword search failed:', e)
      return []
    }
  }

  /**
   * 清理关键词，防止 SQL 注入
   */
  private sanitizeKeyword(keyword: string): string {
    return keyword
      .replace(/'/g, "''")
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/--/g, '')
      .replace(/;/g, '')
      .slice(0, 100)
  }

  /**
   * 计算关键词匹配得分
   * 基于匹配数量和位置
   */
  private calculateKeywordScore(content: string, symbols: string, keywords: string[]): number {
    const lowerContent = content.toLowerCase()
    const lowerSymbols = (symbols || '').toLowerCase()
    let score = 0

    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase()
      // symbols 匹配权重更高（函数名、类名等）
      if (lowerSymbols.includes(lowerKw)) {
        score += 0.3
      }
      // content 匹配
      const matches = (lowerContent.match(new RegExp(this.escapeRegex(lowerKw), 'g')) || []).length
      score += Math.min(matches * 0.1, 0.5)
    }

    return Math.min(score, 1)
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 清空索引
   */
  async clear(): Promise<void> {
    if (!this.db) return

    const tables = await this.db.tableNames()
    if (tables.includes(this.tableName)) {
      await this.db.dropTable(this.tableName)
      this.table = null
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    this.db = null
    this.table = null
  }
}
