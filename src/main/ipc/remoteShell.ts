import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import type { Client as Ssh2Client, ConnectConfig, FileEntry, SFTPWrapper, Stats } from 'ssh2'

interface RemoteServerConfig {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}

interface RemoteEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

let CachedClient: typeof Ssh2Client | null = null

interface RemoteUploadResult {
  canceled: boolean
  uploaded: string[]
}

interface RemoteDownloadResult {
  canceled: boolean
  localPath?: string
}

function getSsh2Client(): typeof Ssh2Client {
  if (CachedClient) return CachedClient

  try {
    const cpuFeaturesPath = require.resolve('cpu-features')
    require.cache[cpuFeaturesPath] = {
      id: cpuFeaturesPath,
      filename: cpuFeaturesPath,
      loaded: true,
      exports: () => null,
      children: [],
      paths: [],
    } as unknown as NodeJS.Module
  } catch {
  }

  const ssh2 = require('ssh2') as { Client: typeof Ssh2Client }
  CachedClient = ssh2.Client
  return CachedClient
}

function normalizeRemotePath(target?: string): string {
  const raw = (target || '.').trim()
  if (!raw || raw === '/') return '/'
  if (raw === '.') return '.'
  const normalized = path.posix.normalize(raw)
  return normalized || '.'
}

function joinRemotePath(base: string, name: string): string {
  if (!base || base === '.') return normalizeRemotePath(name)
  if (base === '/') return path.posix.join('/', name)
  return path.posix.join(base, name)
}


function isDirectoryLike(attrs: { mode?: number; isDirectory?: (() => boolean) | boolean } | undefined): boolean {
  if (!attrs) return false
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory()
  if (typeof attrs.isDirectory === 'boolean') return attrs.isDirectory
  return ((attrs.mode || 0) & 0o170000) === 0o040000
}

function createConnectionConfig(server: RemoteServerConfig): ConnectConfig {
  const config: ConnectConfig = {
    host: server.host.trim(),
    port: server.port && server.port > 0 ? server.port : 22,
    username: server.username?.trim() || 'root',
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    tryKeyboard: Boolean(server.password),
  }

  if (server.privateKeyPath?.trim()) {
    config.privateKey = require('fs').readFileSync(server.privateKeyPath.trim(), 'utf8')
  }

  if (server.password?.trim()) {
    config.password = server.password
  }

  return config
}

async function withSftp<T>(server: RemoteServerConfig, handler: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const Client = getSsh2Client()
  const connection = new Client()
  return await new Promise<T>((resolve, reject) => {
    let settled = false

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      connection.end()
      reject(error)
    }

    connection
      .on('ready', () => {
        connection.sftp(async (error: Error | undefined, sftp: SFTPWrapper | undefined) => {
          if (error || !sftp) {
            fail(error || new Error('Failed to start SFTP session'))
            return
          }

          try {
            const result = await handler(sftp)
            if (settled) return
            settled = true
            connection.end()
            resolve(result)
          } catch (handlerError) {
            fail(handlerError)
          }
        })
      })
      .on('keyboard-interactive', (_name: string, _instructions: string, _lang: string, _prompts: Array<unknown>, finish: (responses: string[]) => void) => {
        finish([server.password || ''])
      })
      .on('error', fail)
      .connect(createConnectionConfig(server))
  })
}

function readdir(sftp: SFTPWrapper, remotePath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error: Error | undefined, list: FileEntry[] | undefined) => {
      if (error) reject(error)
      else resolve(list || [])
    })
  })
}

function stat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error: Error | undefined, attrs: Stats | undefined) => {
      if (error || !attrs) reject(error || new Error('stat failed'))
      else resolve(attrs)
    })
  })
}

function mkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error: Error | null | undefined) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function rmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error: Error | null | undefined) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function unlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error: Error | null | undefined) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function rename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (error: Error | null | undefined) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function mkdirRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const normalized = normalizeRemotePath(remotePath)
  if (normalized === '.' || normalized === '/') return

  const segments = normalized.split('/').filter(Boolean)
  let current = normalized.startsWith('/') ? '/' : ''

  for (const segment of segments) {
    current = current === '/' ? `/${segment}` : current ? `${current}/${segment}` : segment
    try {
      await stat(sftp, current)
    } catch {
      await mkdir(sftp, current)
    }
  }
}

async function removeRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const attrs = await stat(sftp, remotePath)
  if (attrs.isDirectory()) {
    const children = await readdir(sftp, remotePath)
    for (const child of children) {
      await removeRecursive(sftp, joinRemotePath(remotePath, child.filename))
    }
    await rmdir(sftp, remotePath)
    return
  }

  await unlink(sftp, remotePath)
}

async function readTextFile(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const stream = sftp.createReadStream(remotePath, { encoding: undefined })

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > 1024 * 1024) {
        stream.destroy(new Error('File too large to open in editor'))
        return
      }
      chunks.push(buffer)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

async function writeTextFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  const directory = path.posix.dirname(remotePath)
  await mkdirRecursive(sftp, directory)

  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { encoding: 'utf8' })
    stream.on('error', reject)
    stream.on('finish', () => resolve())
    stream.end(content)
  })
}

async function uploadLocalFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  await mkdirRecursive(sftp, path.posix.dirname(remotePath))
  await pipeline(fs.createReadStream(localPath), sftp.createWriteStream(remotePath))
}

async function downloadRemoteFile(sftp: SFTPWrapper, remotePath: string, localPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true })
  await pipeline(sftp.createReadStream(remotePath), fs.createWriteStream(localPath))
}

export function registerRemoteShellHandlers(): void {
  ipcMain.handle('remoteShell:list', async (_, server: RemoteServerConfig, remotePath?: string): Promise<RemoteEntry[]> => {
    return await withSftp(server, async (sftp) => {
      const targetPath = normalizeRemotePath(remotePath || server.remotePath || '.')
      const entries = await readdir(sftp, targetPath)
      return entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => ({
          name: entry.filename,
          path: joinRemotePath(targetPath, entry.filename),
          isDirectory: isDirectoryLike(entry.attrs),
          size: entry.attrs.size,
          modifyTime: entry.attrs.mtime ? entry.attrs.mtime * 1000 : undefined,
        }))
        .sort((left, right) => {
          if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
          return left.name.localeCompare(right.name)
        })
    })
  })

  ipcMain.handle('remoteShell:readText', async (_, server: RemoteServerConfig, remotePath: string): Promise<string | null> => {
    return await withSftp(server, async (sftp) => readTextFile(sftp, normalizeRemotePath(remotePath)))
  })

  ipcMain.handle('remoteShell:writeText', async (_, server: RemoteServerConfig, remotePath: string, content: string): Promise<boolean> => {
    await withSftp(server, async (sftp) => {
      await writeTextFile(sftp, normalizeRemotePath(remotePath), content)
    })
    return true
  })

  ipcMain.handle('remoteShell:mkdir', async (_, server: RemoteServerConfig, remotePath: string): Promise<boolean> => {
    await withSftp(server, async (sftp) => {
      await mkdirRecursive(sftp, normalizeRemotePath(remotePath))
    })
    return true
  })

  ipcMain.handle('remoteShell:rename', async (_, server: RemoteServerConfig, oldPath: string, newPath: string): Promise<boolean> => {
    await withSftp(server, async (sftp) => {
      await rename(sftp, normalizeRemotePath(oldPath), normalizeRemotePath(newPath))
    })
    return true
  })

  ipcMain.handle('remoteShell:delete', async (_, server: RemoteServerConfig, remotePath: string): Promise<boolean> => {
    await withSftp(server, async (sftp) => {
      await removeRecursive(sftp, normalizeRemotePath(remotePath))
    })
    return true
  })

  ipcMain.handle('remoteShell:testConnection', async (_, server: RemoteServerConfig): Promise<{ success: boolean; error?: string }> => {
    try {
      await withSftp(server, async (sftp) => {
        await readdir(sftp, normalizeRemotePath(server.remotePath || '.'))
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('remoteShell:upload', async (event, server: RemoteServerConfig, remoteDirectory: string): Promise<RemoteUploadResult> => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const selection = await dialog.showOpenDialog(window as BrowserWindow, {
      title: 'Upload files to remote server',
      properties: ['openFile', 'multiSelections'],
    })

    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true, uploaded: [] }
    }

    const targetDirectory = normalizeRemotePath(remoteDirectory || server.remotePath || '.')
    const uploaded = await withSftp(server, async (sftp) => {
      const completed: string[] = []
      for (const localPath of selection.filePaths) {
        const remotePath = joinRemotePath(targetDirectory, path.basename(localPath))
        await uploadLocalFile(sftp, localPath, remotePath)
        completed.push(remotePath)
      }
      return completed
    })

    return { canceled: false, uploaded }
  })

  ipcMain.handle('remoteShell:download', async (event, server: RemoteServerConfig, remotePath: string): Promise<RemoteDownloadResult> => {
    const normalizedRemotePath = normalizeRemotePath(remotePath)
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const saveResult = await dialog.showSaveDialog(window as BrowserWindow, {
      title: 'Download remote file',
      defaultPath: path.basename(normalizedRemotePath),
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true }
    }

    await withSftp(server, async (sftp) => {
      const attrs = await stat(sftp, normalizedRemotePath)
      if (attrs.isDirectory()) {
        throw new Error('Downloading directories is not supported yet')
      }

      await downloadRemoteFile(sftp, normalizedRemotePath, saveResult.filePath)
    })

    return { canceled: false, localPath: saveResult.filePath }
  })
}
