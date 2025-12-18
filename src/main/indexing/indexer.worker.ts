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

// Worker message types
type WorkerMessage =
  | { type: 'index', workspacePath: string, config: IndexConfig, existingHashes?: Map<string, string> }
  | { type: 'update', workspacePath: string, file: string, config: IndexConfig }

if (!parentPort) {
  throw new Error('This file must be run as a worker thread.')
}

// Global chunkers (reused across requests)
let regexChunker: ChunkerService | null = null
let tsChunker: TreeSitterChunker | null = null

async function getChunkers(config: IndexConfig) {
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

parentPort.on('message', async (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case 'index':
        await handleIndex(message.workspacePath, message.config, message.existingHashes)
        break
      case 'update':
        await handleUpdate(message.workspacePath, message.file, message.config)
        break
    }
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

async function handleIndex(workspacePath: string, config: IndexConfig, existingHashes?: Map<string, string>) {
  try {
    // 1. Collect files (Moved to worker)
    const files = await collectCodeFiles(workspacePath, config)
    const totalFiles = files.length
    const currentFileSet = new Set(files)

    // Check for deleted files
    if (existingHashes) {
        for (const filePath of existingHashes.keys()) {
            if (!currentFileSet.has(filePath)) {
                parentPort?.postMessage({
                    type: 'update_result',
                    filePath,
                    chunks: [],
                    deleted: true
                })
            }
        }
    }

    parentPort?.postMessage({
      type: 'progress',
      processed: 0,
      total: totalFiles
    })

    if (totalFiles === 0) {
      parentPort?.postMessage({ type: 'complete', totalChunks: 0 })
      return
    }

    const { regexChunker, tsChunker } = await getChunkers(config)
    const embedder = new EmbeddingService(config.embedding)
    const limit = pLimit(10) // Concurrency limit

    let processedFiles = 0
    let totalChunks = 0
    let skippedFiles = 0
    
    // Batch accumulation for results
    let pendingChunks: IndexedChunk[] = []
    const RESULT_BATCH_SIZE = 50

    // Flush pending chunks to main process
    const flushChunks = () => {
      if (pendingChunks.length > 0) {
        parentPort?.postMessage({
          type: 'result',
          chunks: pendingChunks,
          processed: processedFiles,
          total: totalFiles
        })
        pendingChunks = []
      }
    }

    // Process files
    const tasks = files.map(filePath => limit(async () => {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        
        // Skip large files
        if (content.length > config.maxFileSize) {
          processedFiles++
          return
        }

        // Calculate hash first (simple sha256)
        // Note: chunker also calculates hash, but we need it here to decide whether to skip.
        // To avoid double calc, we could use a helper or just let chunker do it.
        // But if we let chunker do it, we have to parse/chunk first, which is CPU work.
        // Hash calc is fast.
        const currentHash = crypto.createHash('sha256').update(content).digest('hex')

        if (existingHashes && existingHashes.get(filePath) === currentHash) {
            skippedFiles++
            processedFiles++
            // Still emit progress occasionally
            if (processedFiles % 10 === 0) {
                parentPort?.postMessage({
                   type: 'progress',
                   processed: processedFiles,
                   total: totalFiles
                })
            }
            return
        }

        // Try Tree-sitter first
        let chunks: CodeChunk[] = []
        try {
            chunks = await tsChunker!.chunkFile(filePath, content, workspacePath)
        } catch (e) {
            console.warn(`Tree-sitter failed for ${filePath}, falling back to regex`, e)
        }
        
        // Fallback to regex if empty
        if (chunks.length === 0) {
             chunks = regexChunker!.chunkFile(filePath, content, workspacePath)
        }
        
        if (chunks.length > 0) {
           // Embed
           const texts = chunks.map(c => prepareTextForEmbedding(c))
           const vectors = await embedder.embedBatch(texts)

           for (let i = 0; i < chunks.length; i++) {
             if (vectors[i]) {
               pendingChunks.push({
                 ...chunks[i],
                 vector: vectors[i]
               })
             }
           }
           totalChunks += chunks.length
        }
        
        processedFiles++
        
        // Periodic flush or progress update
        if (pendingChunks.length >= RESULT_BATCH_SIZE) {
          flushChunks()
        } else if (processedFiles % 10 === 0) {
             parentPort?.postMessage({
                type: 'progress',
                processed: processedFiles,
                total: totalFiles
             })
        }

      } catch (error) {
        console.error(`Error processing file ${filePath}:`, error)
        // Continue even if one file fails
        processedFiles++
      }
    }))

    await Promise.all(tasks)
    
    // Final flush
    flushChunks()

    console.log(`[Worker] Indexing complete. Total: ${totalFiles}, Skipped: ${skippedFiles}, Chunks: ${totalChunks}`)

    parentPort?.postMessage({
      type: 'complete',
      totalChunks
    })

  } catch (error) {
     throw error
  }
}

async function handleUpdate(workspacePath: string, filePath: string, config: IndexConfig) {
  try {
    const { regexChunker, tsChunker } = await getChunkers(config)
    const embedder = new EmbeddingService(config.embedding)

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch {
      // File deleted
      parentPort?.postMessage({
        type: 'update_result',
        filePath,
        chunks: [],
        deleted: true
      })
      return
    }

    const content = await fs.readFile(filePath, 'utf-8')

    if (content.length > config.maxFileSize) {
      return
    }

    // Try Tree-sitter first
    let chunks: CodeChunk[] = []
    try {
        chunks = await tsChunker!.chunkFile(filePath, content, workspacePath)
    } catch (e) {
        console.warn(`Tree-sitter failed for ${filePath}, falling back to regex`, e)
    }
    
    // Fallback to regex if empty
    if (chunks.length === 0) {
            chunks = regexChunker!.chunkFile(filePath, content, workspacePath)
    }

    if (chunks.length === 0) {
      parentPort?.postMessage({
        type: 'update_result',
        filePath,
        chunks: [],
        deleted: true // Treat empty file as deleted (remove old chunks)
      })
      return
    }

    // Embed
    const indexedChunks: IndexedChunk[] = []
    const texts = chunks.map(c => prepareTextForEmbedding(c))
    const vectors = await embedder.embedBatch(texts)

    chunks.forEach((chunk, idx) => {
      if (vectors[idx]) {
        indexedChunks.push({
          ...chunk,
          vector: vectors[idx]
        })
      }
    })

    parentPort?.postMessage({
      type: 'update_result',
      filePath,
      chunks: indexedChunks,
      deleted: false
    })

  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
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
