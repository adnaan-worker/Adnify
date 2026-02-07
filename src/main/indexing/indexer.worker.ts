import { logger } from '@shared/utils/Logger'
import { parentPort } from 'worker_threads'
import * as fs from 'fs/promises'
import { Dirent } from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import pLimit from 'p-limit'
import { ChunkerService } from './chunker'
import { TreeSitterChunker } from './treeSitterChunker'
import { EmbeddingService } from './embedder'
import { CodeChunk, IndexedChunk, IndexConfig } from './types'

/**
 * Worker 消息类型定义
 * 注意：Map 通过 postMessage 传递会变成普通对象，所以用 Record 类型
 */
type WorkerMessage =
  | { type: 'index'; workspacePath: string; config: IndexConfig; existingHashes?: Record<string, string> }
  | { type: 'update'; workspacePath: string; file: string; config: IndexConfig }
  | { type: 'batch_update'; workspacePath: string; files: string[]; config: IndexConfig }

/**
 * Worker 响应消息类型
 */
type WorkerResponse =
  | { type: 'progress'; processed: number; total: number; message?: string }
  | { type: 'result'; chunks: IndexedChunk[]; processed: number; total: number }
  | { type: 'update_result'; filePath: string; chunks: IndexedChunk[]; deleted: boolean }
  | { type: 'batch_update_result'; results: Array<{ filePath: string; chunks: IndexedChunk[]; deleted: boolean }> }
  | { type: 'complete'; totalChunks: number }
  | { type: 'error'; error: string }

if (!parentPort) {
  throw new Error('This file must be run as a worker thread.')
}

// 全局 Chunker 实例（跨请求复用）
let regexChunker: ChunkerService | null = null
let tsChunker: TreeSitterChunker | null = null

async function getChunkers(config: IndexConfig): Promise<{ regexChunker: ChunkerService; tsChunker: TreeSitterChunker }> {
  if (!regexChunker) {
    regexChunker = new ChunkerService(config)
  } else {
    regexChunker.updateConfig(config)
  }

  if (!tsChunker) {
    tsChunker = new TreeSitterChunker(config)
    await tsChunker.init()
  }
  return { regexChunker, tsChunker }
}

function postResponse(response: WorkerResponse): void {
  parentPort?.postMessage(response)
}

parentPort.on('message', async (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case 'index':
        await handleIndex(message.workspacePath, message.config, message.existingHashes)
        break
      case 'update':
        await handleUpdate(message.workspacePath, message.file, message.config)
        break
      case 'batch_update':
        await handleBatchUpdate(message.workspacePath, message.files, message.config)
        break
    }
  } catch (error) {
    postResponse({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

/**
 * 处理全量索引请求
 * existingHashes 是普通对象（Map 通过 postMessage 传递后会序列化）
 */
async function handleIndex(
  workspacePath: string,
  config: IndexConfig,
  existingHashes?: Record<string, string>
): Promise<void> {
  const files = await collectCodeFiles(workspacePath, config)
  const totalFiles = files.length
  const currentFileSet = new Set(files)

  // 检测已删除的文件
  if (existingHashes) {
    for (const filePath of Object.keys(existingHashes)) {
      if (!currentFileSet.has(filePath)) {
        postResponse({ type: 'update_result', filePath, chunks: [], deleted: true })
      }
    }
  }

  postResponse({ type: 'progress', processed: 0, total: totalFiles })

  if (totalFiles === 0) {
    postResponse({ type: 'complete', totalChunks: 0 })
    return
  }

  const { regexChunker, tsChunker } = await getChunkers(config)
  const embedder = new EmbeddingService(config.embedding)
  const limit = pLimit(10)

  // 预热 Embedder (触发模型加载) 并通知 UI
  if (config.mode === 'semantic' && config.embedding.provider === 'transformers') {
    postResponse({ type: 'progress', processed: 0, total: totalFiles, message: 'Loading embedding model (first run may take longer)...' })
    try {
      await embedder.embed('warmup')
    } catch (e) {
      logger.index.error('Failed to load model during warmup:', e)
    }
    postResponse({ type: 'progress', processed: 0, total: totalFiles, message: 'Indexing...' })
  }

  let processedFiles = 0
  let totalChunks = 0
  let skippedFiles = 0
  let pendingChunks: IndexedChunk[] = []
  const RESULT_BATCH_SIZE = 50

  const flushChunks = (): void => {
    if (pendingChunks.length > 0) {
      postResponse({ type: 'result', chunks: pendingChunks, processed: processedFiles, total: totalFiles })
      pendingChunks = []
    }
  }

  const tasks = files.map(filePath => limit(async () => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')

      if (content.length > config.maxFileSize) {
        processedFiles++
        return
      }

      const currentHash = crypto.createHash('sha256').update(content).digest('hex')

      // 使用对象属性访问（不是 Map.get）
      if (existingHashes && existingHashes[filePath] === currentHash) {
        skippedFiles++
        processedFiles++
        if (processedFiles % 10 === 0) {
          postResponse({ type: 'progress', processed: processedFiles, total: totalFiles })
        }
        return
      }

      const chunks = await chunkFile(tsChunker, regexChunker, filePath, content, workspacePath)

      if (chunks.length > 0) {
        const texts = chunks.map(c => prepareTextForEmbedding(c))
        const vectors = await embedder.embedBatch(texts)

        for (let i = 0; i < chunks.length; i++) {
          if (vectors[i]) {
            pendingChunks.push({ ...chunks[i], vector: vectors[i] })
          }
        }
        totalChunks += chunks.length
      }

      processedFiles++

      if (pendingChunks.length >= RESULT_BATCH_SIZE) {
        flushChunks()
      } else if (processedFiles % 10 === 0) {
        postResponse({ type: 'progress', processed: processedFiles, total: totalFiles })
      }
    } catch (error) {
      logger.index.error(`Error processing file ${filePath}:`, error)
      processedFiles++
    }
  }))

  await Promise.all(tasks)
  flushChunks()

  logger.index.info(`[Worker] Indexing complete. Total: ${totalFiles}, Skipped: ${skippedFiles}, Chunks: ${totalChunks}`)
  postResponse({ type: 'complete', totalChunks })
}

/**
 * 处理单文件更新请求
 */
async function handleUpdate(workspacePath: string, filePath: string, config: IndexConfig): Promise<void> {
  const { regexChunker, tsChunker } = await getChunkers(config)
  const embedder = new EmbeddingService(config.embedding)

  // 检查文件是否存在
  try {
    await fs.access(filePath)
  } catch {
    postResponse({ type: 'update_result', filePath, chunks: [], deleted: true })
    return
  }

  const content = await fs.readFile(filePath, 'utf-8')

  if (content.length > config.maxFileSize) {
    return
  }

  const chunks = await chunkFile(tsChunker, regexChunker, filePath, content, workspacePath)

  if (chunks.length === 0) {
    postResponse({ type: 'update_result', filePath, chunks: [], deleted: true })
    return
  }

  const texts = chunks.map(c => prepareTextForEmbedding(c))
  const vectors = await embedder.embedBatch(texts)

  const indexedChunks: IndexedChunk[] = chunks
    .map((chunk, idx) => vectors[idx] ? { ...chunk, vector: vectors[idx] } : null)
    .filter((c): c is IndexedChunk => c !== null)

  postResponse({ type: 'update_result', filePath, chunks: indexedChunks, deleted: false })
}

/**
 * 处理批量文件更新请求
 */
async function handleBatchUpdate(workspacePath: string, files: string[], config: IndexConfig): Promise<void> {
  const { regexChunker, tsChunker } = await getChunkers(config)
  const embedder = new EmbeddingService(config.embedding)
  const limit = pLimit(5) // 批量更新时降低并发

  const results: Array<{ filePath: string; chunks: IndexedChunk[]; deleted: boolean }> = []

  const tasks = files.map(filePath => limit(async () => {
    try {
      // 检查文件是否存在
      try {
        await fs.access(filePath)
      } catch {
        results.push({ filePath, chunks: [], deleted: true })
        return
      }

      const content = await fs.readFile(filePath, 'utf-8')

      if (content.length > config.maxFileSize) {
        return
      }

      const chunks = await chunkFile(tsChunker, regexChunker, filePath, content, workspacePath)

      if (chunks.length === 0) {
        results.push({ filePath, chunks: [], deleted: true })
        return
      }

      const texts = chunks.map(c => prepareTextForEmbedding(c))
      const vectors = await embedder.embedBatch(texts)

      const indexedChunks: IndexedChunk[] = chunks
        .map((chunk, idx) => vectors[idx] ? { ...chunk, vector: vectors[idx] } : null)
        .filter((c): c is IndexedChunk => c !== null)

      results.push({ filePath, chunks: indexedChunks, deleted: false })
    } catch (error) {
      logger.index.error(`[Worker] Error updating file ${filePath}:`, error)
      // 出错的文件跳过，不影响其他文件
    }
  }))

  await Promise.all(tasks)

  postResponse({ type: 'batch_update_result', results })
}

/**
 * 使用 Tree-sitter 或 Regex 分块文件
 */
async function chunkFile(
  tsChunker: TreeSitterChunker,
  regexChunker: ChunkerService,
  filePath: string,
  content: string,
  workspacePath: string
): Promise<CodeChunk[]> {
  let chunks: CodeChunk[] = []

  try {
    chunks = await tsChunker.chunkFile(filePath, content, workspacePath)
  } catch (e) {
    logger.index.warn(`Tree-sitter failed for ${filePath}, falling back to regex`)
  }

  if (chunks.length === 0) {
    chunks = regexChunker.chunkFile(filePath, content, workspacePath)
  }

  return chunks
}

function prepareTextForEmbedding(chunk: CodeChunk): string {
  // Add context
  let text = `File: ${chunk.relativePath}\n`

  if (chunk.symbols && chunk.symbols.length > 0) {
    text += `Symbols: ${chunk.symbols.join(', ')}\n`
  }

  text += `\n${chunk.content}`

  const maxLength = 8000
  if (text.length > maxLength) {
    text = text.slice(0, maxLength)
  }

  return text
}

// File collection logic moved from main process
async function collectCodeFiles(dir: string, config: IndexConfig): Promise<string[]> {
  const files: string[] = []

  const walk = async (currentDir: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      // Skip ignored directories
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name, config)) {
          continue
        }
        await walk(path.join(currentDir, entry.name))
      } else if (entry.isFile()) {
        const fullPath = path.join(currentDir, entry.name)
        if (shouldIndexFile(fullPath, config)) {
          files.push(fullPath)
        }
      }
    }
  }

  await walk(dir)
  return files
}

function shouldIgnoreDir(dirName: string, config: IndexConfig): boolean {
  return config.ignoredDirs.includes(dirName) || dirName.startsWith('.')
}

function shouldIndexFile(filePath: string, config: IndexConfig): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return config.includedExts.includes(ext)
}
