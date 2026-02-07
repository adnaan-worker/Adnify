/**
 * 代码库索引类型定义
 */

// ==================== 索引模式 ====================

/** 索引模式 */
export type IndexMode = 'structural' | 'semantic'

// ==================== 通用类型 ====================

/** 符号类型 */
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'module'

/** 代码块类型 */
export type ChunkType = 'file' | 'function' | 'class' | 'block'

/** 代码块 */
export interface CodeChunk {
  id: string
  filePath: string
  relativePath: string
  fileHash: string
  content: string
  startLine: number
  endLine: number
  type: ChunkType
  language: string
  symbols?: string[]
}

/** 带向量的代码块 */
export interface IndexedChunk extends CodeChunk {
  vector: number[]
}

/** 搜索结果 */
export interface SearchResult {
  filePath: string
  relativePath: string
  content: string
  startLine: number
  endLine: number
  score: number
  type: string
  language: string
}

/** 符号信息 */
export interface SymbolInfo {
  name: string
  kind: SymbolKind
  filePath: string
  relativePath: string
  startLine: number
  endLine: number
  signature?: string
}

/** 索引状态 */
export interface IndexStatus {
  mode: IndexMode
  isIndexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastIndexedAt?: number
  error?: string
  message?: string
}

// ==================== 项目摘要 ====================

/** 目录摘要 */
export interface DirectorySummary {
  path: string
  description?: string
  fileCount: number
  mainFiles: string[]
}

/** 文件摘要 */
export interface FileSummary {
  relativePath: string
  language: string
  symbols: SymbolInfo[]
}

/** 项目摘要 */
export interface ProjectSummary {
  name: string
  structure: DirectorySummary[]
  keyFiles: FileSummary[]
  totalFiles: number
  totalSymbols: number
  languages: Record<string, number>
  generatedAt: number
}

// ==================== Embedding 配置 ====================

export type EmbeddingProvider = 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'transformers' | 'custom'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  apiKey?: string
  model?: string
  baseUrl?: string
  cacheDir?: string
}

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  jina: 'jina-embeddings-v2-base-code',
  voyage: 'voyage-code-2',
  openai: 'text-embedding-3-small',
  cohere: 'embed-english-v3.0',
  huggingface: 'sentence-transformers/all-MiniLM-L6-v2',
  ollama: 'nomic-embed-text',
  transformers: 'Xenova/all-MiniLM-L6-v2',
  custom: '',
}

export const EMBEDDING_ENDPOINTS: Record<EmbeddingProvider, string> = {
  jina: 'https://api.jina.ai/v1/embeddings',
  voyage: 'https://api.voyageai.com/v1/embeddings',
  openai: 'https://api.openai.com/v1/embeddings',
  cohere: 'https://api.cohere.ai/v1/embed',
  huggingface: 'https://api-inference.huggingface.co/pipeline/feature-extraction',
  ollama: 'http://localhost:11434/api/embeddings',
  transformers: '',
  custom: '',
}

// ==================== 索引配置 ====================

export interface IndexConfig {
  mode: IndexMode
  embedding: EmbeddingConfig
  chunkSize: number
  chunkOverlap: number
  maxFileSize: number
  ignoredDirs: string[]
  includedExts: string[]
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  mode: 'structural',  // 默认使用结构化索引
  embedding: { provider: 'jina' },
  chunkSize: 80,
  chunkOverlap: 10,
  maxFileSize: 1024 * 1024,
  ignoredDirs: ['node_modules', '.git', 'dist', 'build', '.adnify', 'coverage', '__pycache__', '.venv', 'venv'],
  includedExts: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte'],
}
