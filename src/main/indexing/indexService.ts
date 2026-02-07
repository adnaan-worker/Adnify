/**
 * 代码库索引服务
 * 支持两种模式：
 * - structural: 结构化索引（默认），基于 Tree-sitter + BM25，零配置
 * - semantic: 语义索引，基于 Embedding + 向量搜索，需要 API
 */

import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { logger, normalizePath } from '@shared/utils'
import { TreeSitterChunker } from './treeSitterChunker'
import { ChunkerService } from './chunker'
import { EmbeddingService } from './embedder'
import { VectorStoreService } from './vectorStore'
import { BM25Index, SymbolIndex } from './search'
import { ProjectSummaryGenerator } from './summary'
import {
  IndexConfig, IndexStatus, IndexMode, SearchResult,
  EmbeddingConfig, ProjectSummary, SymbolInfo, CodeChunk, IndexedChunk,
  DEFAULT_INDEX_CONFIG,
} from './types'
import { getUserConfigDir } from '../services/configPath'

// Worker 消息类型
interface WorkerResultMessage { type: 'result'; chunks: IndexedChunk[]; processed: number; total: number }
interface WorkerUpdateResultMessage { type: 'update_result'; filePath: string; chunks: IndexedChunk[]; deleted: boolean }
interface WorkerBatchUpdateResultMessage { type: 'batch_update_result'; results: Array<{ filePath: string; chunks: IndexedChunk[]; deleted: boolean }> }
interface WorkerCompleteMessage { type: 'complete'; totalChunks: number }
interface WorkerErrorMessage { type: 'error'; error: string }
type WorkerMessage =
  | { type: 'progress'; processed: number; total: number; message?: string }
  | WorkerResultMessage
  | WorkerUpdateResultMessage
  | WorkerBatchUpdateResultMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage

export class CodebaseIndexService {

  private workspacePath: string
  private config: IndexConfig
  private mainWindow: BrowserWindow | null = null

  // 结构化索引组件
  private chunker: TreeSitterChunker
  private fallbackChunker: ChunkerService
  private bm25Index: BM25Index
  private symbolIndex: SymbolIndex
  private summaryGenerator: ProjectSummaryGenerator
  private projectSummary: ProjectSummary | null = null

  // 语义索引组件（按需初始化）
  private embedder: EmbeddingService | null = null
  private vectorStore: VectorStoreService | null = null
  private worker: Worker | null = null

  private status: IndexStatus = {
    mode: 'structural',
    isIndexing: false,
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
  }

  private lastProgressEmit = 0
  private readonly PROGRESS_THROTTLE_MS = 100

  constructor(workspacePath: string, config?: Partial<IndexConfig>) {
    this.workspacePath = workspacePath
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }
    // 注入缓存路径（用于 Worker 中的 Transformers.js）
    if (!this.config.embedding.cacheDir) {
      this.config.embedding.cacheDir = path.join(getUserConfigDir(), 'models')
    }
    this.status.mode = this.config.mode

    // 初始化结构化索引组件
    this.chunker = new TreeSitterChunker(this.config)
    this.fallbackChunker = new ChunkerService(this.config)
    this.bm25Index = new BM25Index()
    this.symbolIndex = new SymbolIndex()
    this.summaryGenerator = new ProjectSummaryGenerator(workspacePath)
  }

  // ==================== 公共 API ====================

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private get structuralIndexPath(): string {
    return path.join(this.workspacePath, '.adnify', 'structural-index.json')
  }

  private get indexStatusPath(): string {
    return path.join(this.workspacePath, '.adnify', 'index-status.json')
  }

  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.chunker.init()

    // 加载缓存的项目摘要
    this.projectSummary = await this.summaryGenerator.loadCache()

    // 加载索引状态和结构化索引
    await this.loadIndex()

    // 语义模式：初始化向量存储
    if (this.config.mode === 'semantic') {
      await this.initSemanticComponents()
    }

    this.initialized = true
    logger.index.info(`[IndexService] Initialized (${this.config.mode} mode) for: `, this.workspacePath)
  }

  /** 加载结构化索引缓存 */
  private async loadStructuralIndex(): Promise<void> {
    try {
      if (fs.existsSync(this.structuralIndexPath)) {
        const content = await fs.promises.readFile(this.structuralIndexPath, 'utf-8')
        const data = JSON.parse(content)
        if (data.bm25) this.bm25Index.fromJSON(data.bm25)
        if (data.symbols) this.symbolIndex.fromJSON(data.symbols)
        this.status.totalChunks = this.bm25Index.size
        this.status.indexedFiles = this.symbolIndex.fileCount
        this.status.totalFiles = data.totalFiles || this.symbolIndex.fileCount
        if (data.savedAt) this.status.lastIndexedAt = data.savedAt
        logger.index.info(`[IndexService] Loaded structural index: ${this.bm25Index.size} chunks, ${this.symbolIndex.size} symbols`)
      }
    } catch (e) {
      logger.index.warn('[IndexService] Failed to load structural index:', e)
    }
  }

  /** 保存结构化索引缓存 */
  private async saveStructuralIndex(): Promise<void> {
    try {
      const dir = path.dirname(this.structuralIndexPath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      const data = {
        bm25: this.bm25Index.toJSON(),
        symbols: this.symbolIndex.toJSON(),
        totalFiles: this.status.totalFiles,
        savedAt: Date.now(),
      }
      await fs.promises.writeFile(this.structuralIndexPath, JSON.stringify(data))
      logger.index.info('[IndexService] Saved structural index')
    } catch (e) {
      logger.index.warn('[IndexService] Failed to save structural index:', e)
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      if (this.config.mode === 'structural') {
        await this.saveStructuralIndex()
      }

      // 保存通用状态
      const dir = path.dirname(this.indexStatusPath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      await fs.promises.writeFile(this.indexStatusPath, JSON.stringify(this.status, null, 2))
    } catch (e) {
      logger.index.warn('[IndexService] Failed to save index status:', e)
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      if (fs.existsSync(this.indexStatusPath)) {
        const content = await fs.promises.readFile(this.indexStatusPath, 'utf-8')
        const status = JSON.parse(content)
        // 恢复状态，除了 isIndexing
        this.status = { ...this.status, ...status, isIndexing: false, error: undefined, message: undefined }
        logger.index.info('[IndexService] Loaded index status')
      }

      if (this.config.mode === 'structural') {
        await this.loadStructuralIndex()
      } else if (this.config.mode === 'semantic') {
        // 语义模式下，chunks 数量可能需要从 vectorStore 获取？
        // 暂时相信保存的状态。
        // 也可以调用 vectorStore.count() 验证
        // if (this.vectorStore) { 
        //   this.status.totalChunks = await this.vectorStore.count()
        // }
      }
    } catch (e) {
      logger.index.warn('[IndexService] Failed to load index status:', e)
    }
  }

  /** 清除结构化索引缓存 */
  private async clearStructuralIndexCache(): Promise<void> {
    try {
      if (fs.existsSync(this.structuralIndexPath)) {
        await fs.promises.unlink(this.structuralIndexPath)
      }
    } catch (e) {
      logger.index.warn('[IndexService] Failed to clear structural index cache:', e)
    }
  }

  getStatus(): IndexStatus {
    return { ...this.status }
  }

  getMode(): IndexMode {
    return this.config.mode
  }

  /** 切换索引模式 */
  async setMode(mode: IndexMode): Promise<void> {
    if (mode === this.config.mode) return

    this.config.mode = mode
    this.status.mode = mode

    if (mode === 'semantic') {
      await this.initSemanticComponents()
    }

    logger.index.info(`[IndexService] Switched to ${mode} mode`)
  }

  /** 检查是否有索引 */
  async hasIndex(): Promise<boolean> {
    // 检查内存中的索引
    if (this.bm25Index.size > 0) return true
    // 检查缓存的摘要
    if (this.projectSummary) return true
    // 语义模式检查向量存储
    if (this.config.mode === 'semantic') {
      return this.vectorStore?.hasIndex() ?? false
    }
    return false
  }

  /** 全量索引 */
  async indexWorkspace(): Promise<void> {
    if (this.status.isIndexing) {
      logger.index.info('[IndexService] Already indexing, skipping...')
      return
    }

    this.status = { ...this.status, isIndexing: true, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    this.emitProgress()

    try {
      if (this.config.mode === 'structural') {
        await this.buildStructuralIndex()
        await this.saveStructuralIndex()
      } else {
        await this.buildSemanticIndex()
      }

      this.status.isIndexing = false
      this.status.lastIndexedAt = Date.now()
      this.emitProgress(true)
    } catch (e) {
      logger.index.error('[IndexService] Indexing failed:', e)
      this.status.error = e instanceof Error ? e.message : String(e)
      this.status.isIndexing = false
      this.emitProgress(true)
    }
  }

  /** 搜索 */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (this.config.mode === 'structural') {
      return this.bm25Index.search(query, topK)
    }

    if (!this.vectorStore?.isInitialized() || !this.embedder) {
      throw new Error('Semantic index not initialized')
    }

    const queryVector = await this.embedder.embed(query)
    return this.vectorStore.search(queryVector, topK)
  }

  /** 混合搜索 */
  async hybridSearch(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (this.config.mode === 'structural') {
      // 结构化模式：BM25 + 符号搜索融合
      const bm25Results = this.bm25Index.search(query, topK * 2)
      const symbolResults = this.symbolIndex.search(query, topK)

      return this.fuseResults(bm25Results, symbolResults, topK)
    }

    // 语义模式：向量 + 关键词搜索融合
    if (!this.vectorStore?.isInitialized() || !this.embedder) {
      throw new Error('Semantic index not initialized')
    }

    const keywords = this.extractKeywords(query)
    const [semanticResults, keywordResults] = await Promise.all([
      this.search(query, topK * 2),
      keywords.length > 0 ? this.vectorStore.keywordSearch(keywords, topK * 2) : Promise.resolve([])
    ])

    if (keywordResults.length === 0) return semanticResults.slice(0, topK)
    return this.fuseResultsRRF(semanticResults, keywordResults, topK)
  }

  /** 符号搜索 */
  searchSymbols(query: string, topK: number = 20): SymbolInfo[] {
    return this.symbolIndex.search(query, topK)
  }

  /** 获取项目摘要 */
  getProjectSummary(): ProjectSummary | null {
    return this.projectSummary
  }

  /** 获取项目摘要文本 */
  getProjectSummaryText(): string {
    if (!this.projectSummary) return ''
    return this.summaryGenerator.toText(this.projectSummary)
  }

  /** 获取文件符号 */
  getFileSymbols(relativePath: string): SymbolInfo[] {
    return this.symbolIndex.getFileSymbols(relativePath)
  }

  /** 清空索引 */
  async clearIndex(): Promise<void> {
    this.bm25Index.clear()
    this.symbolIndex.clear()
    this.projectSummary = null

    if (this.vectorStore) {
      await this.vectorStore.clear()
    }

    // 删除缓存文件
    await this.summaryGenerator.clearCache()
    await this.clearStructuralIndexCache()

    this.status = { ...this.status, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    logger.index.info('[IndexService] Index cleared')
  }

  /** 批量更新文件（用于文件监听） */
  async updateFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return

    logger.index.info(`[IndexService] Updating ${filePaths.length} files...`)

    // 结构化模式：增量更新
    if (this.config.mode === 'structural') {
      let updated = 0
      for (const filePath of filePaths) {
        try {
          const ext = path.extname(filePath).toLowerCase()
          if (!this.config.includedExts.includes(ext)) continue

          // 检查文件是否存在
          if (!fs.existsSync(filePath)) {
            // 文件被删除，从索引中移除
            await this.deleteFileFromStructuralIndex(filePath)
            updated++
            continue
          }

          const content = await fs.promises.readFile(filePath, 'utf-8')
          if (content.length > this.config.maxFileSize) continue

          const chunks = await this.chunkFile(filePath, content)
          const relativePath = path.relative(this.workspacePath, filePath)

          // 先删除该文件的旧索引
          await this.deleteFileFromStructuralIndex(filePath)

          // 添加新索引
          for (const chunk of chunks) {
            this.bm25Index.addDocument({
              id: chunk.id,
              filePath: chunk.filePath,
              relativePath: chunk.relativePath,
              content: chunk.content,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              type: chunk.type,
              language: chunk.language,
              symbols: chunk.symbols || [],
            })

            if (chunk.symbols) {
              for (const name of chunk.symbols) {
                this.symbolIndex.add({
                  name,
                  kind: chunk.type === 'function' ? 'function' : chunk.type === 'class' ? 'class' : 'function',
                  filePath: chunk.filePath,
                  relativePath,
                  startLine: chunk.startLine,
                  endLine: chunk.endLine,
                })
              }
            }
          }
          updated++
        } catch (e) {
          logger.index.warn(`[IndexService] Failed to update ${filePath}: `, e)
        }
      }

      if (updated > 0) {
        // 重建 BM25 索引（必须调用以更新 IDF）
        this.bm25Index.build()
        // 保存到缓存
        await this.saveStructuralIndex()
        logger.index.info(`[IndexService] Updated ${updated} files in structural index`)
      }
      return
    }

    // 语义模式：通过 worker 处理
    if (this.vectorStore?.isInitialized() && this.worker) {
      this.worker.postMessage({
        type: 'batch_update',
        workspacePath: this.workspacePath,
        files: filePaths,
        config: this.config
      })
    }
  }

  /** 从结构化索引中删除文件 */
  private async deleteFileFromStructuralIndex(filePath: string): Promise<void> {
    const relativePath = path.relative(this.workspacePath, filePath)

    // 从 BM25 索引中删除
    this.bm25Index.deleteFile(relativePath)

    // 从符号索引中删除
    this.symbolIndex.deleteFile(relativePath)
  }

  /** 删除文件索引 */
  async deleteFileIndex(filePath: string): Promise<void> {
    const relativePath = path.relative(this.workspacePath, filePath)

    // 结构化模式：从索引中删除
    if (this.config.mode === 'structural') {
      await this.deleteFileFromStructuralIndex(filePath)
      this.bm25Index.build()
      await this.saveStructuralIndex()
      logger.index.info(`[IndexService] Deleted structural index for: ${relativePath} `)
      return
    }

    // 语义模式：从向量存储删除
    if (this.config.mode === 'semantic' && this.vectorStore) {
      await this.vectorStore.deleteFile(filePath)
      logger.index.info(`[IndexService] Deleted semantic index for: ${relativePath} `)
    }
  }

  /** 更新 Embedding 配置 */
  updateEmbeddingConfig(config: Partial<EmbeddingConfig>): void {
    this.config.embedding = { ...this.config.embedding, ...config }
    if (this.embedder) {
      this.embedder.updateConfig(this.config.embedding)
    }
  }

  /** 测试 Embedding 连接 */
  async testEmbeddingConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    if (!this.embedder) {
      this.embedder = new EmbeddingService(this.config.embedding)
    }
    return this.embedder.testConnection()
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
  }

  // ==================== 结构化索引 ====================

  private async buildStructuralIndex(): Promise<void> {
    const files = await this.collectFiles()
    this.status.totalFiles = files.length

    this.bm25Index.clear()
    this.symbolIndex.clear()

    const languages: Record<string, number> = {}
    const fileSymbols = new Map<string, SymbolInfo[]>()
    let processed = 0

    for (const filePath of files) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8')
        if (content.length > this.config.maxFileSize) continue

        const chunks = await this.chunkFile(filePath, content)
        const relativePath = path.relative(this.workspacePath, filePath)
        const symbols: SymbolInfo[] = []

        for (const chunk of chunks) {
          // 添加到 BM25
          this.bm25Index.addDocument({
            id: chunk.id,
            filePath: chunk.filePath,
            relativePath: chunk.relativePath,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            type: chunk.type,
            language: chunk.language,
            symbols: chunk.symbols || [],
          })

          // 提取符号
          if (chunk.symbols) {
            for (const name of chunk.symbols) {
              const symbol: SymbolInfo = {
                name,
                kind: chunk.type === 'function' ? 'function' : chunk.type === 'class' ? 'class' : 'function',
                filePath: chunk.filePath,
                relativePath: chunk.relativePath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                signature: chunk.content.split('\n')[0].slice(0, 100),
              }
              symbols.push(symbol)
              this.symbolIndex.add(symbol)
            }
          }

          // 语言统计
          languages[chunk.language] = (languages[chunk.language] || 0) + 1
        }

        if (symbols.length > 0) {
          fileSymbols.set(relativePath, symbols)
        }

        this.status.totalChunks += chunks.length
      } catch (e) {
        logger.index.warn(`[IndexService] Failed to index ${filePath}: `, e)
      }

      processed++
      this.status.indexedFiles = processed
      if (processed % 20 === 0) this.emitProgress()
    }

    // 构建 BM25 索引
    this.bm25Index.build()

    // 生成项目摘要
    this.projectSummary = this.summaryGenerator.generate(fileSymbols, languages)

    logger.index.info(`[IndexService] Structural index built: ${this.bm25Index.size} chunks, ${this.symbolIndex.size} symbols`)
  }

  // ==================== 语义索引 ====================

  private async initSemanticComponents(): Promise<void> {
    if (!this.embedder) {
      this.embedder = new EmbeddingService(this.config.embedding)
    }
    if (!this.vectorStore) {
      this.vectorStore = new VectorStoreService(this.workspacePath)
      await this.vectorStore.initialize()
    }
  }

  private async buildSemanticIndex(): Promise<void> {
    await this.initSemanticComponents()

    if (!this.worker) {
      this.initWorker()
    }

    const existingHashesMap = await this.vectorStore!.getFileHashes()
    const existingHashes: Record<string, string> = Object.fromEntries(existingHashesMap)

    this.worker?.postMessage({
      type: 'index',
      workspacePath: this.workspacePath,
      config: this.config,
      existingHashes
    })
  }

  private initWorker(): void {
    try {
      const workerPath = path.join(__dirname, 'indexer.worker.js')
      this.worker = new Worker(workerPath)

      this.worker.on('message', async (message: WorkerMessage) => {
        switch (message.type) {
          case 'progress':
            this.status.indexedFiles = message.processed
            if (message.total) this.status.totalFiles = message.total
            // 如果有 message 字段，这里可以更新 status.currentFile 或者专门的 message 字段
            // 目前 IndexStatus 只有 error 字段比较接近文本信息，或者我们可以扩展 IndexStatus
            // 暂时先用 log 记录，或者扩展 IndexStatus
            // 更好的方式是扩展 IndexStatus 添加 message 字段
            if (message.message) {
              this.status.message = message.message
              this.emitProgress(true) // Force emit on message change
            }
            this.emitProgress()
            break

          case 'result':
            if (message.chunks?.length > 0) {
              await this.vectorStore!.addBatch(message.chunks)
              this.status.totalChunks += message.chunks.length
            }
            this.status.indexedFiles = message.processed
            this.emitProgress()
            break

          case 'update_result':
            if (message.deleted) {
              await this.vectorStore!.deleteFile(message.filePath)
            } else if (message.chunks?.length > 0) {
              await this.vectorStore!.upsertFile(message.filePath, message.chunks)
            }
            this.emitProgress()
            break

          case 'batch_update_result':
            for (const res of message.results) {
              if (res.deleted) {
                await this.vectorStore!.deleteFile(res.filePath)
              } else if (res.chunks?.length > 0) {
                await this.vectorStore!.upsertFile(res.filePath, res.chunks)
              }
            }
            this.emitProgress()
            break

          case 'complete':
            this.status.isIndexing = false
            this.status.lastIndexedAt = Date.now()
            this.status.message = undefined // Clear message
            if (typeof message.totalChunks === 'number') {
              this.status.totalChunks = message.totalChunks
            }
            logger.index.info(`[IndexService] Semantic indexing complete: ${this.status.totalChunks} chunks`)
            this.saveIndex() // Save state
            this.emitProgress(true)
            break

          case 'error':
            logger.index.error('[IndexService] Worker error:', message.error)
            this.status.error = message.error
            this.status.isIndexing = false
            this.status.message = undefined // Clear message
            this.emitProgress(true)
            break
        }
      })

      this.worker.on('error', (err) => {
        logger.index.error('[IndexService] Worker thread error:', err.message)
        this.status.error = err.message
        this.status.isIndexing = false
        this.emitProgress()
      })
    } catch (e) {
      logger.index.error('[IndexService] Failed to initialize worker:', e)
    }
  }

  // ==================== 工具方法 ====================

  private async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    let chunks = await this.chunker.chunkFile(filePath, content, this.workspacePath)
    if (chunks.length === 0) {
      chunks = this.fallbackChunker.chunkFile(filePath, content, this.workspacePath)
    }
    return chunks
  }

  private async collectFiles(): Promise<string[]> {
    const files: string[] = []

    const walk = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!this.config.ignoredDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (this.config.includedExts.includes(ext)) {
            files.push(fullPath)
          }
        }
      }
    }

    await walk(this.workspacePath)
    return files
  }

  private extractKeywords(query: string): string[] {
    return query.split(/[\s,.:;!?()[\]{}'"<>]+/).map(t => t.trim()).filter(t => t.length >= 2 && !/^\d+$/.test(t))
  }

  /** 融合 BM25 和符号搜索结果 */
  private fuseResults(bm25Results: SearchResult[], symbolResults: SymbolInfo[], topK: number): SearchResult[] {
    const scoreMap = new Map<string, { result: SearchResult; score: number }>()

    // BM25 结果
    bm25Results.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      scoreMap.set(key, { result, score: result.score + (bm25Results.length - rank) / bm25Results.length })
    })

    // 符号匹配加分
    for (const symbol of symbolResults) {
      const key = `${symbol.filePath}:${symbol.startLine} `
      const existing = scoreMap.get(key)
      if (existing) {
        existing.score += 0.5
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score }) => ({ ...result, score }))
  }

  /** RRF 融合 */
  private fuseResultsRRF(results1: SearchResult[], results2: SearchResult[], topK: number): SearchResult[] {
    const k = 60
    const scoreMap = new Map<string, { result: SearchResult; score: number }>()

    results1.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      scoreMap.set(key, { result, score: 0.7 / (k + rank + 1) })
    })

    results2.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      const existing = scoreMap.get(key)
      if (existing) {
        existing.score += 0.3 / (k + rank + 1)
      } else {
        scoreMap.set(key, { result, score: 0.3 / (k + rank + 1) })
      }
    })

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score }) => ({ ...result, score }))
  }

  private emitProgress(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastProgressEmit < this.PROGRESS_THROTTLE_MS) return
    this.lastProgressEmit = now

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('index:progress', this.status)
      } catch { }
    }
  }
}

// ==================== 实例管理 ====================

const instances = new Map<string, CodebaseIndexService>()

export function getIndexService(workspacePath: string): CodebaseIndexService {
  const normalized = normalizePath(workspacePath)
  let instance = instances.get(normalized)
  if (!instance) {
    instance = new CodebaseIndexService(workspacePath)
    instances.set(normalized, instance)
  }
  return instance
}

export function initIndexServiceWithConfig(workspacePath: string, config: Partial<IndexConfig>): CodebaseIndexService {
  const normalized = normalizePath(workspacePath)
  let instance = instances.get(normalized)
  if (!instance) {
    instance = new CodebaseIndexService(workspacePath, config)
    instances.set(normalized, instance)
  } else {
    // 更新现有实例的配置
    if (config.mode) instance.setMode(config.mode)
    if (config.embedding) instance.updateEmbeddingConfig(config.embedding)
  }
  return instance
}

export function destroyIndexService(workspacePath?: string): void {
  if (workspacePath) {
    const normalized = normalizePath(workspacePath)
    const instance = instances.get(normalized)
    if (instance) {
      instance.destroy()
      instances.delete(normalized)
    }
  } else {
    for (const instance of instances.values()) {
      instance.destroy()
    }
    instances.clear()
  }
}
