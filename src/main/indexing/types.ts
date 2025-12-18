/**
 * 代码库索引类型定义
 */

// Embedding 提供商类型
export type EmbeddingProvider = 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama'

// Embedding 配置
export interface EmbeddingConfig {
  provider: EmbeddingProvider
  apiKey?: string
  model?: string
  baseUrl?: string  // 自定义端点
}

// 默认模型配置
export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  jina: 'jina-embeddings-v2-base-code',
  voyage: 'voyage-code-2',
  openai: 'text-embedding-3-small',
  cohere: 'embed-english-v3.0',
  huggingface: 'sentence-transformers/all-MiniLM-L6-v2',
  ollama: 'nomic-embed-text',
}

// Embedding API 端点
export const EMBEDDING_ENDPOINTS: Record<EmbeddingProvider, string> = {
  jina: 'https://api.jina.ai/v1/embeddings',
  voyage: 'https://api.voyageai.com/v1/embeddings',
  openai: 'https://api.openai.com/v1/embeddings',
  cohere: 'https://api.cohere.ai/v1/embed',
  huggingface: 'https://api-inference.huggingface.co/pipeline/feature-extraction',
  ollama: 'http://localhost:11434/api/embeddings',
}

// 向量维度
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'jina-embeddings-v2-base-code': 768,
  'voyage-code-2': 1536,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'embed-english-v3.0': 1024,
  'all-MiniLM-L6-v2': 384,
  'nomic-embed-text': 768,
}

// 代码块
export interface CodeChunk {
  id: string
  filePath: string
  relativePath: string
  fileHash: string     // 文件内容哈希（用于增量更新）
  content: string
  startLine: number
  endLine: number
  type: 'file' | 'function' | 'class' | 'block'
  language: string
  symbols?: string[]  // 函数名、类名等
}

// 索引后的代码块（带向量）
export interface IndexedChunk extends CodeChunk {
  vector: number[]
}

// 搜索结果
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

// 索引状态
export interface IndexStatus {
  isIndexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastIndexedAt?: number
  error?: string
}

// 索引配置
export interface IndexConfig {
  embedding: EmbeddingConfig
  chunkSize: number        // 每个块的最大行数
  chunkOverlap: number     // 块之间的重叠行数
  maxFileSize: number      // 最大文件大小（字节）
  ignoredDirs: string[]    // 忽略的目录
  includedExts: string[]   // 包含的文件扩展名
}

// 默认索引配置
export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  embedding: {
    provider: 'jina',
    model: 'jina-embeddings-v2-base-code',
  },
  chunkSize: 80,
  chunkOverlap: 10,
  maxFileSize: 1024 * 1024,  // 1MB
  ignoredDirs: ['node_modules', '.git', 'dist', 'build', '.adnify', 'coverage', '__pycache__', '.venv', 'venv'],
  includedExts: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte'],
}
