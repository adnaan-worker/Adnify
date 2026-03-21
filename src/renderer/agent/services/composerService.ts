/**
 * Composer Service
 * Cursor-style multi-file editing support
 * 
 * Features:
 * - Batch file modifications
 * - Unified diff view for all changes
 * - Accept/Reject all functionality
 * - Change grouping and ordering
 */

// ============ Types ============
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { getDirname } from '@shared/utils/pathUtils'
import { internalWriteTracker } from '@/renderer/services/internalWriteTracker'


export interface FileChange {
  filePath: string
  relativePath: string
  oldContent: string | null  // null for new files
  newContent: string | null  // null for deleted files
  changeType: 'create' | 'modify' | 'delete'
  linesAdded: number
  linesRemoved: number
  // Tracking
  toolCallId?: string
  status: 'pending' | 'accepted' | 'rejected'
}

export interface ComposerSession {
  id: string
  title: string
  description?: string
  changes: FileChange[]
  createdAt: number
  status: 'active' | 'completed' | 'cancelled'
  // Stats
  totalFiles: number
  totalLinesAdded: number
  totalLinesRemoved: number
}

export interface ComposerState {
  currentSession: ComposerSession | null
  sessions: ComposerSession[]
  isProcessing: boolean
}

// ============ Composer Service ============

class ComposerServiceClass {
  private state: ComposerState = {
    currentSession: null,
    sessions: [],
    isProcessing: false,
  }

  private listeners: Set<(state: ComposerState) => void> = new Set()

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: ComposerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach(listener => listener(this.state))
  }

  /**
   * Get current state
   */
  getState(): ComposerState {
    return { ...this.state }
  }

  /**
   * Start a new composer session
   */
  startSession(title: string, description?: string): string {
    const id = `composer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    const session: ComposerSession = {
      id,
      title,
      description,
      changes: [],
      createdAt: Date.now(),
      status: 'active',
      totalFiles: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    }

    this.state.currentSession = session
    this.state.sessions.unshift(session)
    this.notify()

    return id
  }

  /**
   * Ensure a session exists, starting one if necessary
   */
  ensureSession(title = 'Agent Changes', description = 'Changes from AI Agent'): void {
    if (!this.state.currentSession) {
      this.startSession(title, description)
    }
  }

  /**
   * Add a file change to the current session
   */
  addChange(change: Omit<FileChange, 'status'>): void {
    if (!this.state.currentSession) {
      logger.agent.warn('[Composer] No active session')
      return
    }

    const fullChange: FileChange = {
      ...change,
      status: 'pending',
    }

    // Check if file already has a change
    const existingIndex = this.state.currentSession.changes.findIndex(
      c => c.filePath === change.filePath
    )

    if (existingIndex >= 0) {
      // Update existing change
      this.state.currentSession.changes[existingIndex] = fullChange
    } else {
      // Add new change
      this.state.currentSession.changes.push(fullChange)
    }

    // Update stats
    this.updateSessionStats()
    this.notify()
  }

  /**
   * Accept a single change
   */
  async acceptChange(filePath: string): Promise<boolean> {
    if (!this.state.currentSession) return false

    const change = this.state.currentSession.changes.find(c => c.filePath === filePath)
    if (!change || change.status !== 'pending') return false

    try {
      if (change.changeType === 'delete') {
        await api.file.delete(filePath)
      } else if (change.newContent !== null) {
        // Ensure parent directory exists
        const parentDir = filePath.replace(/[/\\][^/\\]+$/, '')
        if (parentDir && parentDir !== filePath) {
          await api.file.mkdir(parentDir)
        }
        internalWriteTracker.mark(filePath)
        await api.file.write(filePath, change.newContent)
      }

      change.status = 'accepted'
      this.notify()
      return true
    } catch (error) {
      logger.agent.error('[Composer] Failed to accept change:', error)
      return false
    }
  }

  /**
   * Reject a single change
   */
  async rejectChange(filePath: string): Promise<boolean> {
    if (!this.state.currentSession) return false

    const change = this.state.currentSession.changes.find(c => c.filePath === filePath)
    if (!change || change.status !== 'pending') return false

    // Restore original content if it was modified
    if (change.changeType === 'modify' && change.oldContent !== null) {
      try {
        internalWriteTracker.mark(filePath)
        await api.file.write(filePath, change.oldContent)
      } catch (error) {
        logger.agent.error('[Composer] Failed to restore file:', error)
      }
    }

    change.status = 'rejected'
    this.notify()
    return true
  }

  /**
   * Accept all pending changes
   */
  async acceptAll(): Promise<{ accepted: number; failed: number }> {
    if (!this.state.currentSession) return { accepted: 0, failed: 0 }

    let accepted = 0
    let failed = 0

    for (const change of this.state.currentSession.changes) {
      if (change.status === 'pending') {
        const success = await this.acceptChange(change.filePath)
        if (success) {
          accepted++
        } else {
          failed++
        }
      }
    }

    // Check if session is complete
    this.checkSessionComplete()

    return { accepted, failed }
  }

  /**
   * Reject all pending changes
   */
  async rejectAll(): Promise<{ rejected: number; failed: number }> {
    if (!this.state.currentSession) return { rejected: 0, failed: 0 }

    let rejected = 0
    let failed = 0

    for (const change of this.state.currentSession.changes) {
      if (change.status === 'pending') {
        const success = await this.rejectChange(change.filePath)
        if (success) {
          rejected++
        } else {
          failed++
        }
      }
    }

    // Check if session is complete
    this.checkSessionComplete()

    return { rejected, failed }
  }

  /**
   * Complete the current session
   */
  completeSession(): void {
    if (!this.state.currentSession) return

    this.state.currentSession.status = 'completed'
    this.state.currentSession = null
    this.notify()
  }

  /**
   * Cancel the current session (reject all and close)
   */
  async cancelSession(): Promise<void> {
    if (!this.state.currentSession) return

    await this.rejectAll()
    this.state.currentSession.status = 'cancelled'
    this.state.currentSession = null
    this.notify()
  }

  /**
   * Get changes grouped by directory
   */
  getChangesGroupedByDirectory(): Map<string, FileChange[]> {
    if (!this.state.currentSession) return new Map()

    const groups = new Map<string, FileChange[]>()

    for (const change of this.state.currentSession.changes) {
      const dir = getDirname(change.relativePath) || '.'

      if (!groups.has(dir)) {
        groups.set(dir, [])
      }
      groups.get(dir)!.push(change)
    }

    return groups
  }

  /**
   * Get summary of changes
   */
  getSummary(): {
    pending: number
    accepted: number
    rejected: number
    total: number
  } {
    if (!this.state.currentSession) {
      return { pending: 0, accepted: 0, rejected: 0, total: 0 }
    }

    const changes = this.state.currentSession.changes
    return {
      pending: changes.filter(c => c.status === 'pending').length,
      accepted: changes.filter(c => c.status === 'accepted').length,
      rejected: changes.filter(c => c.status === 'rejected').length,
      total: changes.length,
    }
  }

  /**
   * Generate unified diff for all changes
   */
  generateUnifiedDiff(): string {
    if (!this.state.currentSession) return ''

    let diff = ''

    for (const change of this.state.currentSession.changes) {
      diff += `\n${'='.repeat(60)}\n`
      diff += `File: ${change.relativePath}\n`
      diff += `Type: ${change.changeType}\n`
      diff += `Status: ${change.status}\n`
      diff += `Lines: +${change.linesAdded} -${change.linesRemoved}\n`
      diff += `${'='.repeat(60)}\n\n`

      if (change.changeType === 'create') {
        diff += `+++ ${change.relativePath} (new file)\n`
        if (change.newContent) {
          diff += change.newContent.split('\n').map(l => `+ ${l}`).join('\n')
        }
      } else if (change.changeType === 'delete') {
        diff += `--- ${change.relativePath} (deleted)\n`
        if (change.oldContent) {
          diff += change.oldContent.split('\n').map(l => `- ${l}`).join('\n')
        }
      } else {
        // Modified - show simple diff
        diff += `--- ${change.relativePath}\n`
        diff += `+++ ${change.relativePath}\n`
        // For a real diff, we'd use a diff algorithm here
        // This is simplified
        if (change.oldContent && change.newContent) {
          const oldLines = change.oldContent.split('\n')
          const newLines = change.newContent.split('\n')

          // Simple line-by-line comparison
          const maxLines = Math.max(oldLines.length, newLines.length)
          for (let i = 0; i < maxLines; i++) {
            const oldLine = oldLines[i]
            const newLine = newLines[i]

            if (oldLine === newLine) {
              diff += `  ${oldLine || ''}\n`
            } else {
              if (oldLine !== undefined) diff += `- ${oldLine}\n`
              if (newLine !== undefined) diff += `+ ${newLine}\n`
            }
          }
        }
      }

      diff += '\n'
    }

    return diff
  }

  // ============ Private Methods ============

  private updateSessionStats(): void {
    if (!this.state.currentSession) return

    const changes = this.state.currentSession.changes
    this.state.currentSession.totalFiles = changes.length
    this.state.currentSession.totalLinesAdded = changes.reduce((sum, c) => sum + c.linesAdded, 0)
    this.state.currentSession.totalLinesRemoved = changes.reduce((sum, c) => sum + c.linesRemoved, 0)
  }

  private checkSessionComplete(): void {
    if (!this.state.currentSession) return

    const hasPending = this.state.currentSession.changes.some(c => c.status === 'pending')
    if (!hasPending) {
      this.state.currentSession.status = 'completed'
    }
  }
}

// Export singleton
export const composerService = new ComposerServiceClass()

// Export types
export type { ComposerServiceClass }
