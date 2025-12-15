import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, exec, ChildProcess } from 'child_process'
import Store from 'electron-store'
import { LLMService } from './llm/llmService'

const store = new Store()
let mainWindow: BrowserWindow | null = null
let llmService: LLMService | null = null
let terminalProcess: ChildProcess | null = null

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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})


// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// Shell (Background execution for Git etc)
ipcMain.handle('shell:execute', async (_, command: string, cwd?: string) => {
    return new Promise((resolve) => {
        exec(command, { cwd: cwd || process.cwd() }, (error, stdout, stderr) => {
            resolve({
                output: stdout,
                errorOutput: stderr,
                exitCode: error ? error.code || 1 : 0
            })
        })
    })
})

// File operations
ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
            { name: 'All Files', extensions: ['*'] },
            { name: 'JavaScript', extensions: ['js', 'jsx', 'ts', 'tsx'] },
            { name: 'Python', extensions: ['py'] },
        ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const content = fs.readFileSync(filePath, 'utf-8')
        return { path: filePath, content }
    }
    return null
})

ipcMain.handle('file:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0]
        store.set('lastWorkspacePath', folderPath)
        return folderPath
    }
    return null
})

ipcMain.handle('workspace:restore', () => {
    return store.get('lastWorkspacePath')
})

ipcMain.handle('file:readDir', async (_, dirPath: string) => {
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true })
        return items.map(item => ({
            name: item.name,
            path: path.join(dirPath, item.name),
            isDirectory: item.isDirectory()
        }))
    } catch {
        return []
    }
})

ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
        return fs.readFileSync(filePath, 'utf-8')
    } catch {
        return null
    }
})

ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
        fs.writeFileSync(filePath, content, 'utf-8')
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:save', async (_, content: string, currentPath?: string) => {
    if (currentPath) {
        fs.writeFileSync(currentPath, content, 'utf-8')
        return currentPath
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, content, 'utf-8')
        return result.filePath
    }
    return null
})

ipcMain.handle('file:exists', async (_, filePath: string) => {
    return fs.existsSync(filePath)
})

ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    try {
        fs.mkdirSync(dirPath, { recursive: true })
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true })
        } else {
            fs.unlinkSync(filePath)
        }
        return true
    } catch {
        return false
    }
})

ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    try {
        fs.renameSync(oldPath, newPath)
        return true
    } catch (error) {
        console.error('Rename error:', error)
        return false
    }
})


interface SearchOptions {
    isRegex: boolean
    isCaseSensitive: boolean
    isWholeWord: boolean
    include?: string
    exclude?: string
}

ipcMain.handle('file:search', async (_, query: string, rootPath: string, options: SearchOptions = { isRegex: false, isCaseSensitive: false, isWholeWord: false }) => {
    if (!query || !rootPath) return []

    const MAX_RESULTS = 2000
    const results: { path: string; line: number; text: string }[] = []
    
    const DEFAULT_IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.vscode', '.idea', 'coverage'])
    const IGNORED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.pdf', '.exe', '.dll', '.bin', '.node', '.lock'])

    let searchRegex: RegExp
    try {
        let pattern = query
        const flags = options.isCaseSensitive ? 'g' : 'gi'
        
        if (!options.isRegex) {
            pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }
        
        if (options.isWholeWord) {
            pattern = `\\b${pattern}\\b`
        }
        
        searchRegex = new RegExp(pattern, flags)
    } catch {
        return []
    }

    const excludeTerms = options.exclude ? options.exclude.split(',').map(s => s.trim()).filter(Boolean) : []

    function searchRecursive(dir: string) {
        if (results.length >= MAX_RESULTS) return

        try {
            const items = fs.readdirSync(dir, { withFileTypes: true })

            for (const item of items) {
                if (results.length >= MAX_RESULTS) break
                
                const fullPath = path.join(dir, item.name)
                
                if (excludeTerms.some(term => fullPath.includes(term))) continue

                if (item.isDirectory()) {
                    if (!DEFAULT_IGNORED.has(item.name)) {
                        searchRecursive(fullPath)
                    }
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase()
                    if (IGNORED_EXTS.has(ext)) continue

                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8')
                        const lines = content.split('\n')
                        
                        for (let i = 0; i < lines.length; i++) {
                            searchRegex.lastIndex = 0
                            if (searchRegex.test(lines[i])) {
                                results.push({
                                    path: fullPath,
                                    line: i + 1,
                                    text: lines[i].trim().substring(0, 150)
                                })
                                if (results.length >= MAX_RESULTS) break
                            }
                        }
                    } catch {
                        // Ignore read errors
                    }
                }
            }
        } catch (e) {
            console.error('Search error in dir:', dir, e)
        }
    }

    searchRecursive(rootPath)
    return results
})

// Settings
ipcMain.handle('settings:get', (_, key: string) => store.get(key))
ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    store.set(key, value)
    return true
})

// LLM
ipcMain.handle('llm:sendMessage', async (_, params) => {
    console.log('[Main] llm:sendMessage received, provider:', params?.config?.provider, 'model:', params?.config?.model)
    console.log('[Main] baseUrl:', params?.config?.baseUrl)
    try {
        await llmService?.sendMessage(params)
        console.log('[Main] sendMessage completed')
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error)
        console.error('[Main] sendMessage error:', errMsg)
        throw error
    }
})

ipcMain.on('llm:abort', () => {
    llmService?.abort()
})


// Terminal
ipcMain.handle('terminal:create', async (_, options?: { cwd?: string }) => {
    console.log('[Main] Received terminal:create request', options)
    
    if (terminalProcess) {
        console.log('[Main] Killing existing terminal process')
        try {
            terminalProcess.kill()
        } catch (e) {
            console.error('[Main] Failed to kill existing terminal:', e)
        }
        terminalProcess = null
    }

    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    
    const workingDir = options?.cwd || process.cwd()
    console.log(`[Main] Spawning shell: ${shell} in ${workingDir}`)

    try {
        terminalProcess = spawn(shell, [], {
            cwd: workingDir,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe']
        })
        
        console.log(`[Main] Terminal spawned, PID: ${terminalProcess.pid}`)

        terminalProcess.stdout?.on('data', (data) => {
            mainWindow?.webContents.send('terminal:data', data.toString())
        })

        terminalProcess.stderr?.on('data', (data) => {
            mainWindow?.webContents.send('terminal:data', data.toString())
        })

        terminalProcess.on('exit', (code) => {
            console.log(`[Main] Terminal exited with code ${code}`)
            mainWindow?.webContents.send('terminal:exit', code)
            terminalProcess = null
        })

        return true
    } catch (e) {
        console.error('[Main] Failed to spawn terminal:', e)
        throw e
    }
})

ipcMain.handle('terminal:input', (_, data: string) => {
    if (terminalProcess && terminalProcess.stdin) {
        terminalProcess.stdin.write(data)
    }
})

ipcMain.handle('terminal:resize', (_, _cols: number, _rows: number) => {
    // node-pty supports this, but raw spawn does not easily without native modules.
})

ipcMain.on('terminal:kill', () => {
    if (terminalProcess) {
        terminalProcess.kill()
        terminalProcess = null
    }
})
