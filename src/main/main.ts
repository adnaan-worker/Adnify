/**
 * Adnify Main Process
 * 使用原生模块实现高性能
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import { spawn } from 'child_process'
import Store from 'electron-store'
import { LLMService } from './llm/llmService'
import { registerLspHandlers, stopLanguageServer } from './lspServer'

// ==========================================
// Native Modules - 原生高性能模块
// ==========================================

// 终端 - node-pty (原生 PTY) - 延迟加载避免 Electron 启动问题
// import * as pty from 'node-pty'
let pty: typeof import('node-pty') | null = null

function getPty() {
    if (!pty) {
        pty = require('node-pty')
    }
    return pty
}

// 文件搜索 - ripgrep (原生搜索，比 JS 快 10x+)
import { rgPath } from '@vscode/ripgrep'

// 文件监听 - @parcel/watcher (比 chokidar 更快更省内存)
import * as watcher from '@parcel/watcher'

// 文件编码检测
import * as jschardet from 'jschardet'
import * as iconv from 'iconv-lite'

// 代码库索引服务
import { getIndexService, destroyIndexService, EmbeddingConfig, IndexConfig } from './indexing'

// ==========================================
// Store 初始化
// ==========================================

const bootstrapStore = new Store({ name: 'bootstrap' })
let mainStore: Store

function initStore() {
    const customPath = bootstrapStore.get('customConfigPath') as string | undefined
    if (customPath && fs.existsSync(customPath)) {
        console.log('[Main] Using custom config path:', customPath)
        mainStore = new Store({ cwd: customPath })
    } else {
        console.log('[Main] Using default config path')
        mainStore = new Store()
    }
}
initStore()

// ==========================================
// 全局状态
// ==========================================

let mainWindow: BrowserWindow | null = null
let llmService: LLMService | null = null

// 终端会话管理
const terminals = new Map<string, import('node-pty').IPty>()

// 文件监听订阅
let watcherSubscription: watcher.AsyncSubscription | null = null

// ==========================================
// 窗口创建
// ==========================================

function createWindow() {
    const iconPath = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../../public/icon.png')
        : path.join(__dirname, '../renderer/icon.png')

    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1200,
        minHeight: 700,
        frame: false,
        titleBarStyle: 'hidden',
        icon: iconPath,
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173')
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    llmService = new LLMService(mainWindow)
}

app.whenReady().then(() => {
    // 注册 LSP 处理器
    registerLspHandlers()
    
    createWindow()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// 清理资源
app.on('before-quit', async () => {
    // 关闭所有终端
    terminals.forEach(term => term.kill())
    terminals.clear()
    
    // 停止文件监听
    if (watcherSubscription) {
        await watcherSubscription.unsubscribe()
    }
    
    // 停止 LSP 服务器
    stopLanguageServer()
})

// ==========================================
// Window Controls
// ==========================================

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ==========================================
// Shell Execution (非交互式命令)
// ==========================================

ipcMain.handle('shell:execute', async (_, command: string, cwd?: string, timeout: number = 60000) => {
    const { exec } = require('child_process')
    return new Promise((resolve) => {
        exec(command, { 
            cwd: cwd || process.cwd(),
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: timeout
        }, (error: any, stdout: string, stderr: string) => {
            resolve({
                output: stdout,
                errorOutput: stderr,
                exitCode: error ? error.code || 1 : 0
            })
        })
    })
})

// ==========================================
// File Operations (原生增强)
// ==========================================

ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const content = await readFileWithEncoding(filePath)
        return { path: filePath, content }
    }
    return null
})

ipcMain.handle('dialog:showOpen', async (_, options: { 
    properties?: string[]
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[] 
}) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: (options.properties || ['openFile']) as any,
        defaultPath: options.defaultPath,
        filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths
    }
    return null
})

ipcMain.handle('file:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0]
        mainStore.set('lastWorkspacePath', folderPath)
        
        // 启动原生文件监听 (@parcel/watcher)
        await startFileWatcher(folderPath)

        return folderPath
    }
    return null
})

// 原生文件监听 - 比 chokidar 更快
async function startFileWatcher(folderPath: string) {
    // 停止之前的监听
    if (watcherSubscription) {
        await watcherSubscription.unsubscribe()
    }

    try {
        watcherSubscription = await watcher.subscribe(folderPath, (err: Error | null, events: watcher.Event[]) => {
            if (err) {
                console.error('[Watcher] Error:', err)
                return
            }
            
            for (const event of events) {
                mainWindow?.webContents.send('file:changed', {
                    event: event.type, // 'create' | 'update' | 'delete'
                    path: event.path
                })
            }
        }, {
            ignore: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/*.log'
            ]
        })
        
        console.log('[Watcher] Started watching:', folderPath)
    } catch (e) {
        console.error('[Watcher] Failed to start:', e)
    }
}

ipcMain.handle('workspace:restore', async () => {
    const lastPath = mainStore.get('lastWorkspacePath') as string | undefined
    if (lastPath && fs.existsSync(lastPath)) {
        // 恢复工作区时也启动文件监听
        await startFileWatcher(lastPath)
    }
    return lastPath
})

ipcMain.handle('file:readDir', async (_, dirPath: string) => {
    try {
        const items = await fsPromises.readdir(dirPath, { withFileTypes: true })
        return items.map(item => ({
            name: item.name,
            path: path.join(dirPath, item.name),
            isDirectory: item.isDirectory()
        }))
    } catch {
        return []
    }
})

// 目录树生成
ipcMain.handle('file:getTree', async (_, dirPath: string, maxDepth: number = 2) => {
    if (!dirPath) return ''
    try {
        await fsPromises.access(dirPath)
    } catch {
        return ''
    }
    
    const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.vscode', '.idea', 'coverage', 'tmp', '.adnify'])
    const IGNORED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.exe', '.dll', '.bin', '.lock'])

    async function buildTree(currentPath: string, depth: number, prefix: string = ''): Promise<string> {
        if (depth > maxDepth) return ''
        try {
            const items = (await fsPromises.readdir(currentPath, { withFileTypes: true }))
                .sort((a, b) => {
                    if (a.isDirectory() && !b.isDirectory()) return -1
                    if (!a.isDirectory() && b.isDirectory()) return 1
                    return a.name.localeCompare(b.name)
                })
            
            let result = ''
            const filteredItems = items.filter(item => {
                if (item.isDirectory() && IGNORED_DIRS.has(item.name)) return false
                if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase()
                    if (IGNORED_EXTS.has(ext)) return false
                }
                return true
            })
            
            for (let i = 0; i < filteredItems.length; i++) {
                const item = filteredItems[i]
                const isLast = i === filteredItems.length - 1
                const pointer = isLast ? '└── ' : '├── '
                result += `${prefix}${pointer}${item.name}${item.isDirectory() ? '/' : ''}\n`
                
                if (item.isDirectory()) {
                    const nextPrefix = prefix + (isLast ? '    ' : '│   ')
                    result += await buildTree(path.join(currentPath, item.name), depth + 1, nextPrefix)
                }
            }
            return result
        } catch { return '' }
    }
    return buildTree(dirPath, 0)
})


// ==========================================
// Native Search (Ripgrep - 比 JS 快 10x+)
// ==========================================

interface SearchOptions {
    isRegex: boolean
    isCaseSensitive: boolean
    isWholeWord: boolean
    include?: string
    exclude?: string
}

ipcMain.handle('file:search', async (_, query: string, rootPath: string, options: SearchOptions) => {
    if (!query || !rootPath) return []

    return new Promise((resolve) => {
        const args = [
            '--json',
            '--max-count', '2000',
            '--max-filesize', '1M', // 跳过大文件
        ]

        if (options?.isCaseSensitive) args.push('--case-sensitive')
        else args.push('--smart-case')

        if (options?.isWholeWord) args.push('--word-regexp')
        if (!options?.isRegex) args.push('--fixed-strings')

        // 默认忽略
        const defaultIgnores = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
        defaultIgnores.forEach(glob => args.push('--glob', `!${glob}`))

        if (options?.exclude) {
            options.exclude.split(',').forEach(ex => args.push('--glob', `!${ex.trim()}`))
        }
        if (options?.include) {
            options.include.split(',').forEach(inc => args.push('--glob', inc.trim()))
        }

        args.push('--', query, rootPath)

        const rg = spawn(rgPath, args)
        let output = ''

        rg.stdout.on('data', (data) => { output += data.toString() })
        rg.stderr.on('data', (data) => { console.error('[ripgrep]', data.toString()) })

        rg.on('close', () => {
            const results: any[] = []
            const lines = output.split('\n')
            for (const line of lines) {
                if (!line.trim()) continue
                try {
                    const json = JSON.parse(line)
                    if (json.type === 'match') {
                        results.push({
                            path: json.data.path.text,
                            line: json.data.line_number,
                            text: json.data.lines.text.trim().slice(0, 500) // 限制长度
                        })
                    }
                } catch {}
            }
            resolve(results)
        })

        rg.on('error', (err) => {
            console.error('[ripgrep] spawn error:', err)
            resolve([])
        })
    })
})

// ==========================================
// File Read/Write (带编码检测)
// ==========================================

// 智能读取文件（自动检测编码）
async function readFileWithEncoding(filePath: string): Promise<string> {
    try {
        const buffer = await fsPromises.readFile(filePath)
        
        // 检测编码
        const detected = jschardet.detect(buffer)
        const encoding = detected.encoding || 'utf-8'
        
        // 如果是 UTF-8 或 ASCII，直接返回
        if (encoding.toLowerCase() === 'utf-8' || encoding.toLowerCase() === 'ascii') {
            return buffer.toString('utf-8')
        }
        
        // 其他编码使用 iconv-lite 转换
        if (iconv.encodingExists(encoding)) {
            return iconv.decode(buffer, encoding)
        }
        
        // 回退到 UTF-8
        return buffer.toString('utf-8')
    } catch (e) {
        console.error('[File] Read error:', e)
        return ''
    }
}

// 流式读取大文件（避免内存爆炸）
async function readLargeFile(filePath: string, startLine: number = 0, maxLines: number = 1000): Promise<string> {
    return new Promise((resolve, reject) => {
        const lines: string[] = []
        let lineCount = 0
        
        const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
        let buffer = ''
        
        stream.on('data', (chunk: string | Buffer) => {
            buffer += chunk.toString()
            const parts = buffer.split('\n')
            buffer = parts.pop() || ''
            
            for (const line of parts) {
                if (lineCount >= startLine && lines.length < maxLines) {
                    lines.push(line)
                }
                lineCount++
                
                if (lines.length >= maxLines) {
                    stream.destroy()
                    break
                }
            }
        })
        
        stream.on('end', () => {
            if (buffer && lines.length < maxLines) {
                lines.push(buffer)
            }
            resolve(lines.join('\n'))
        })
        
        stream.on('error', reject)
    })
}

ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
        const stats = await fsPromises.stat(filePath)
        
        // 大文件使用流式读取
        if (stats.size > 5 * 1024 * 1024) { // > 5MB
            console.log('[File] Large file, using stream:', filePath)
            return await readLargeFile(filePath, 0, 10000)
        }
        
        return await readFileWithEncoding(filePath)
    } catch {
        return null
    }
})

ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
        // 确保目录存在
        const dir = path.dirname(filePath)
        try {
            await fsPromises.access(dir)
        } catch {
            await fsPromises.mkdir(dir, { recursive: true })
        }
        await fsPromises.writeFile(filePath, content, 'utf-8')
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:ensureDir', async (_, dirPath: string) => {
    try {
        await fsPromises.mkdir(dirPath, { recursive: true })
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:showInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
})

ipcMain.handle('file:save', async (_, content: string, currentPath?: string) => {
    if (currentPath) {
        await fsPromises.writeFile(currentPath, content, 'utf-8')
        return currentPath
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePath) {
        await fsPromises.writeFile(result.filePath, content, 'utf-8')
        return result.filePath
    }
    return null
})

ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
        await fsPromises.access(filePath)
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    try {
        await fsPromises.mkdir(dirPath, { recursive: true })
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
        const stat = await fsPromises.stat(filePath)
        if (stat.isDirectory()) {
            await fsPromises.rm(filePath, { recursive: true, force: true })
        } else {
            await fsPromises.unlink(filePath)
        }
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    try {
        await fsPromises.rename(oldPath, newPath)
        return true
    } catch {
        return false
    }
})

// ==========================================
// Settings
// ==========================================

ipcMain.handle('settings:get', (_, key: string) => mainStore.get(key))
ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    mainStore.set(key, value)
    return true
})

ipcMain.handle('settings:getDataPath', () => mainStore.path)
ipcMain.handle('settings:setDataPath', async (_, newPath: string) => {
    try {
        if (!fs.existsSync(newPath)) throw new Error('Directory does not exist')
        const currentData = mainStore.store
        const newStore = new Store({ cwd: newPath })
        newStore.store = currentData
        bootstrapStore.set('customConfigPath', newPath)
        mainStore = newStore
        return true
    } catch {
        return false
    }
})

// ==========================================
// LLM
// ==========================================

ipcMain.handle('llm:sendMessage', async (_, params) => {
    try {
        await llmService?.sendMessage(params)
    } catch (error: any) {
        throw error
    }
})

ipcMain.on('llm:abort', () => llmService?.abort())


// ==========================================
// Native Terminal (node-pty)
// ==========================================

ipcMain.handle('terminal:create', async (_, options: { id: string; cwd?: string; shell?: string }) => {
    const { id, cwd, shell: customShell } = options
    if (terminals.has(id)) return true

    const isWindows = process.platform === 'win32'
    const defaultShell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    const shellToUse = customShell || defaultShell
    const workingDir = cwd || process.cwd()

    try {
        const nodePty = getPty()!
        const ptyProcess = nodePty.spawn(shellToUse, [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: workingDir,
            env: process.env as any
        })

        terminals.set(id, ptyProcess)

        ptyProcess.onData((data) => {
            mainWindow?.webContents.send('terminal:data', { id, data })
        })

        ptyProcess.onExit(({ exitCode }) => {
            mainWindow?.webContents.send('terminal:exit', { id, code: exitCode })
            terminals.delete(id)
        })

        return true
    } catch (e) {
        console.error(`[Terminal] Failed to spawn PTY ${id}:`, e)
        return false
    }
})

ipcMain.handle('terminal:input', (_, { id, data }: { id: string; data: string }) => {
    const term = terminals.get(id)
    if (term) term.write(data)
})

ipcMain.handle('terminal:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const term = terminals.get(id)
    if (term) term.resize(cols, rows)
})

ipcMain.on('terminal:kill', (_, id?: string) => {
    if (id) {
        const term = terminals.get(id)
        if (term) {
            term.kill()
            terminals.delete(id)
        }
    } else {
        terminals.forEach(term => term.kill())
        terminals.clear()
    }
})

ipcMain.handle('terminal:get-shells', async () => {
    const { execSync } = require('child_process')
    const shells: { label: string; path: string }[] = []
    
    // 通过系统命令检测可用的 shell
    const findShell = (cmd: string): string[] => {
        try {
            const result = process.platform === 'win32'
                ? execSync(`where ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
                : execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
            return result.trim().split(/\r?\n/).filter(Boolean)
        } catch {
            return []
        }
    }
    
    if (process.platform === 'win32') {
        // Windows shells - 这些是系统内置的，直接用命令名
        shells.push({ label: 'PowerShell', path: 'powershell.exe' })
        shells.push({ label: 'Command Prompt', path: 'cmd.exe' })
        
        // Git Bash - 需要找到真正的 Git bash，排除 System32 下的 WSL bash
        const bashPaths = findShell('bash')
        const gitBash = bashPaths.find(p => 
            p.toLowerCase().includes('git') && fs.existsSync(p)
        )
        if (gitBash) {
            shells.push({ label: 'Git Bash', path: gitBash })
        }
        
        // WSL - 检查是否真正可用
        const wslPaths = findShell('wsl')
        if (wslPaths.length > 0) {
            try {
                execSync('wsl --list --quiet', { stdio: 'ignore', timeout: 2000 })
                shells.push({ label: 'WSL', path: 'wsl.exe' })
            } catch {
                // WSL not properly configured
            }
        }
    } else {
        // Unix-like systems
        const bash = findShell('bash')[0]
        if (bash) shells.push({ label: 'Bash', path: bash })
        
        const zsh = findShell('zsh')[0]
        if (zsh) shells.push({ label: 'Zsh', path: zsh })
        
        const fish = findShell('fish')[0]
        if (fish) shells.push({ label: 'Fish', path: fish })
    }
    
    return shells
})

// ==========================================
// Git Operations (使用 dugite 原生绑定)
// ==========================================

// Git 操作通过 dugite 实现，比 child_process 调用 git CLI 更快
// dugite 是 GitHub Desktop 使用的原生 Git 库

ipcMain.handle('git:exec', async (_, args: string[], cwd: string) => {
    try {
        const { GitProcess } = require('dugite')
        const result = await GitProcess.exec(args, cwd)
        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
        }
    } catch (e) {
        // 如果 dugite 不可用，回退到 child_process
        return new Promise((resolve) => {
            const { exec } = require('child_process')
            exec(`git ${args.join(' ')}`, { cwd }, (error: any, stdout: string, stderr: string) => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: error ? error.code || 1 : 0
                })
            })
        })
    }
})


// ==========================================
// Codebase Indexing (代码库索引)
// ==========================================

// 初始化索引服务
ipcMain.handle('index:initialize', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        indexService.setMainWindow(mainWindow!)
        await indexService.initialize()
        return { success: true }
    } catch (e) {
        console.error('[Index] Initialize failed:', e)
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 开始全量索引
ipcMain.handle('index:start', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        indexService.setMainWindow(mainWindow!)
        await indexService.initialize()
        
        // 异步执行索引，不阻塞
        indexService.indexWorkspace().catch(e => {
            console.error('[Index] Indexing failed:', e)
        })
        
        return { success: true }
    } catch (e) {
        console.error('[Index] Start failed:', e)
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 获取索引状态
ipcMain.handle('index:status', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        await indexService.initialize()
        return indexService.getStatus()
    } catch (e) {
        return { isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    }
})

// 检查是否有索引
ipcMain.handle('index:hasIndex', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        await indexService.initialize()
        return indexService.hasIndex()
    } catch {
        return false
    }
})

// 语义搜索
ipcMain.handle('index:search', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
        const indexService = getIndexService(workspacePath)
        await indexService.initialize()
        return await indexService.search(query, topK || 10)
    } catch (e) {
        console.error('[Index] Search failed:', e)
        return []
    }
})

// 更新单个文件的索引
ipcMain.handle('index:updateFile', async (_, workspacePath: string, filePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        await indexService.updateFile(filePath)
        return { success: true }
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 清空索引
ipcMain.handle('index:clear', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        await indexService.clearIndex()
        return { success: true }
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 更新 Embedding 配置
ipcMain.handle('index:updateEmbeddingConfig', async (_, workspacePath: string, config: Partial<EmbeddingConfig>) => {
    try {
        const indexService = getIndexService(workspacePath)
        indexService.updateEmbeddingConfig(config)
        return { success: true }
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 测试 Embedding 连接
ipcMain.handle('index:testConnection', async (_, workspacePath: string) => {
    try {
        const indexService = getIndexService(workspacePath)
        return await indexService.testEmbeddingConnection()
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
})

// 获取支持的 Embedding 提供商列表
ipcMain.handle('index:getProviders', () => {
    return [
        { id: 'jina', name: 'Jina AI', description: '免费 100万 tokens/月，专为代码优化', free: true },
        { id: 'voyage', name: 'Voyage AI', description: '免费 5000万 tokens，代码专用模型', free: true },
        { id: 'cohere', name: 'Cohere', description: '免费 100次/分钟', free: true },
        { id: 'huggingface', name: 'HuggingFace', description: '免费，有速率限制', free: true },
        { id: 'ollama', name: 'Ollama', description: '本地运行，完全免费', free: true },
        { id: 'openai', name: 'OpenAI', description: '付费，质量最高', free: false },
    ]
})
