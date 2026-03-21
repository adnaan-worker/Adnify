import { api } from '@/renderer/services/electronAPI'
import type { OpenFile } from '@store/slices/fileSlice'
import type { RemoteServerConfig } from '../types'

export interface RemoteFileBinding {
  server: RemoteServerConfig
  remotePath: string
}

function sanitizeSegment(value?: string): string {
  return (value || 'unknown').replace(/[\\/:*?"<>|]/g, '_')
}

export function buildRemoteEditorPath(server: RemoteServerConfig, remotePath: string): string {
  const host = sanitizeSegment(server.host)
  const user = sanitizeSegment(server.username || 'root')
  const port = server.port || 22
  const normalizedRemotePath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`
  return `/__remote__/${user}@${host}:${port}${normalizedRemotePath}`
}

export function isRemoteOpenFile(file: Pick<OpenFile, 'remote'> | null | undefined): file is OpenFile & { remote: RemoteFileBinding } {
  return Boolean(file?.remote?.server?.host && file?.remote?.remotePath)
}

export async function saveOpenFile(file: OpenFile): Promise<boolean> {
  if (isRemoteOpenFile(file)) {
    return await api.remoteShell.writeText(file.remote.server, file.remote.remotePath, file.content)
  }
  return await api.file.write(file.path, file.content)
}
