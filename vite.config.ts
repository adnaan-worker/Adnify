import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'path'

// 外部依赖（不打包到 bundle）
const EXTERNAL_DEPS = [
  'electron',
  'electron-store',
  'electron-updater',
  '@anthropic-ai/sdk',
  'openai',
  '@google/genai',
  'node-pty',
  '@parcel/watcher',
  '@parcel/watcher-win32-x64',
  '@parcel/watcher-win32-arm64',
  '@parcel/watcher-darwin-x64',
  '@parcel/watcher-darwin-arm64',
  '@parcel/watcher-linux-x64-glibc',
  '@parcel/watcher-linux-x64-musl',
  '@parcel/watcher-linux-arm64-glibc',
  '@parcel/watcher-linux-arm64-musl',
  'dugite',
  '@vscode/ripgrep',
  '@lancedb/lancedb',
  'apache-arrow',
  '@xenova/transformers',
  'onnxruntime-node',
  'onnxruntime-web'
]

// 路径别名配置
const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@main': path.resolve(__dirname, './src/main'),
  '@renderer': path.resolve(__dirname, './src/renderer'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@components': path.resolve(__dirname, './src/renderer/components'),
  '@features': path.resolve(__dirname, './src/renderer/features'),
  '@services': path.resolve(__dirname, './src/renderer/services'),
  '@store': path.resolve(__dirname, './src/renderer/store'),
  '@hooks': path.resolve(__dirname, './src/renderer/hooks'),
  '@utils': path.resolve(__dirname, './src/renderer/utils'),
  '@app-types': path.resolve(__dirname, './src/renderer/types'),
  'vscode-nls': path.resolve(__dirname, './node_modules/monaco-editor-nls')
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: EXTERNAL_DEPS,
              onwarn(warning, warn) {
                if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        entry: 'src/main/indexing/indexer.worker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/indexing/indexer.worker.ts',
              formats: ['cjs'],
              fileName: () => 'indexer.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', '@lancedb/lancedb', 'apache-arrow', 'web-tree-sitter', '@xenova/transformers', 'onnxruntime-node', 'onnxruntime-web'],
              onwarn(warning, warn) {
                if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) { options.reload() },
        vite: {
          build: { outDir: 'dist/preload' }
        }
      }
    ])
  ],
  resolve: { alias: aliases },
  base: './',
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
      // 忽略 web-tree-sitter 的 eval 警告（这是库内部使用，无法避免）
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) {
          return
        }
        warn(warning)
      },
      output: {
        manualChunks(id) {
          // Monaco Editor
          if (id.includes('monaco-editor') || id.includes('@monaco-editor/react')) {
            return 'monaco-editor'
          }
          // React 核心
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          // 状态管理 + 图标
          if (id.includes('node_modules/zustand') || id.includes('node_modules/lucide-react')) {
            return 'ui-core'
          }
          // 终端
          if (id.includes('@xterm/')) {
            return 'terminal'
          }
          // Markdown
          if (id.includes('react-markdown')) {
            return 'markdown-core'
          }
          // Syntax Highlighter（单独分包，按需加载）
          if (id.includes('react-syntax-highlighter')) {
            return 'syntax-highlighter'
          }
          // 动画
          if (id.includes('framer-motion')) {
            return 'animation'
          }
          // Agent 模块
          if (id.includes('/renderer/agent/')) {
            return 'agent'
          }
          // Sidebar 模块
          if (id.includes('/renderer/components/sidebar/')) {
            return 'sidebar'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
    minify: 'esbuild',
    target: 'esnext',
    cssCodeSplit: true,
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['monaco-editor']
  }
})
