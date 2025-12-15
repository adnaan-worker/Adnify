import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'
import { LLMService } from './llm/llmService'

const store = new Store()
let mainWindow: BrowserWindow | null = null
let llmService: LLMService | null = null
let terminalProcess: ChildProcess | null = null

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1600,
		height: 1000,
		minWidth: 1200,
		minHeight: 700,
		frame: false,
		titleBarStyle: 'hidden',
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
		return result.filePaths[0]
	}
	return null
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

// Settings
ipcMain.handle('settings:get', (_, key: string) => store.get(key))
ipcMain.handle('settings:set', (_, key: string, value: any) => {
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
	} catch (error: any) {
		console.error('[Main] sendMessage error:', error.message)
		throw error
	}
})

ipcMain.on('llm:abort', () => {
	llmService?.abort()
})

// Terminal
ipcMain.handle('terminal:execute', async (_, command: string, cwd?: string) => {
	return new Promise((resolve) => {
		const isWindows = process.platform === 'win32'
		const shell = isWindows ? 'cmd.exe' : '/bin/bash'
		const shellArgs = isWindows ? ['/c', command] : ['-c', command]

		const workingDir = cwd || process.cwd()

		terminalProcess = spawn(shell, shellArgs, {
			cwd: workingDir,
			env: process.env,
		})

		let output = ''
		let errorOutput = ''

		terminalProcess.stdout?.on('data', (data) => {
			const text = data.toString()
			output += text
			mainWindow?.webContents.send('terminal:output', text)
		})

		terminalProcess.stderr?.on('data', (data) => {
			const text = data.toString()
			errorOutput += text
			mainWindow?.webContents.send('terminal:output', text)
		})

		terminalProcess.on('close', (code) => {
			resolve({ output, errorOutput, exitCode: code })
			terminalProcess = null
		})

		terminalProcess.on('error', (err) => {
			resolve({ output: '', errorOutput: err.message, exitCode: 1 })
			terminalProcess = null
		})
	})
})

ipcMain.on('terminal:kill', () => {
	if (terminalProcess) {
		terminalProcess.kill()
		terminalProcess = null
	}
})
