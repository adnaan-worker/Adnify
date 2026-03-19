export type EditFileMode = 'string' | 'line' | 'batch'

export type EditFileBatchAction = 'replace' | 'insert' | 'delete'

export interface EditFileBatchEdit {
  action: EditFileBatchAction
  start_line?: number
  end_line?: number
  after_line?: number
  content?: string
}

export interface EditFileStringArgs {
  path?: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface EditFileLineArgs {
  path?: string
  start_line: number
  end_line: number
  content: string
}

export interface EditFileBatchArgs {
  path?: string
  edits: EditFileBatchEdit[]
}

export type EditFileResolvedArgs = EditFileStringArgs | EditFileLineArgs | EditFileBatchArgs

export type EditFileResolution =
  | { ok: true; mode: 'string'; normalized: Record<string, unknown>; args: EditFileStringArgs }
  | { ok: true; mode: 'line'; normalized: Record<string, unknown>; args: EditFileLineArgs }
  | { ok: true; mode: 'batch'; normalized: Record<string, unknown>; args: EditFileBatchArgs }
  | { ok: false; normalized: Record<string, unknown>; error: string }

function hasStringFields(data: Record<string, unknown>): boolean {
  return data.old_string !== undefined || data.new_string !== undefined
}

function hasLineFields(data: Record<string, unknown>): boolean {
  return data.start_line !== undefined || data.end_line !== undefined
}

function hasBatchFields(data: Record<string, unknown>): boolean {
  return Array.isArray(data.edits) && data.edits.length > 0
}

function isLinePlaceholder(data: Record<string, unknown>): boolean {
  if (data.content !== '') {
    return false
  }

  if (typeof data.start_line !== 'number' || typeof data.end_line !== 'number') {
    return false
  }

  // Tool UIs sometimes serialize an unused line-mode form as 0/0 or 1/1 with empty content.
  return data.start_line === data.end_line && data.start_line <= 1
}

function isEmptyStringPlaceholder(data: Record<string, unknown>): boolean {
  return data.old_string === '' && data.new_string === ''
}

export function normalizeEditFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }

  if (Array.isArray(normalized.edits) && normalized.edits.length === 0) {
    delete normalized.edits
  }

  const stringFields = hasStringFields(normalized)
  const lineFields = hasLineFields(normalized)
  const batchFields = hasBatchFields(normalized)

  if ((stringFields || batchFields) && isLinePlaceholder(normalized)) {
    delete normalized.start_line
    delete normalized.end_line
    delete normalized.content
  }

  if ((lineFields || batchFields) && isEmptyStringPlaceholder(normalized)) {
    delete normalized.old_string
    delete normalized.new_string
    delete normalized.replace_all
  }

  return normalized
}

export function resolveEditFileRequest(data: Record<string, unknown>): EditFileResolution {
  const normalized = normalizeEditFileArgs(data)

  const stringMode = hasStringFields(normalized)
  const lineMode = hasLineFields(normalized)
  const batchMode = hasBatchFields(normalized)

  const modeCount = [stringMode, lineMode, batchMode].filter(Boolean).length
  if (modeCount > 1) {
    return {
      ok: false,
      normalized,
      error: 'Cannot mix string mode, line mode, and batch mode parameters',
    }
  }

  if (modeCount === 0) {
    return {
      ok: false,
      normalized,
      error: 'Must provide either (old_string + new_string), (start_line + end_line + content), or (edits array)',
    }
  }

  if (stringMode) {
    const old_string = normalized.old_string
    const new_string = normalized.new_string

    if (typeof old_string !== 'string' || old_string.length === 0 || typeof new_string !== 'string') {
      return {
        ok: false,
        normalized,
        error: 'String mode requires both old_string and new_string',
      }
    }

    return {
      ok: true,
      mode: 'string',
      normalized,
      args: {
        path: typeof normalized.path === 'string' ? normalized.path : undefined,
        old_string,
        new_string,
        replace_all: normalized.replace_all === true,
      },
    }
  }

  if (lineMode) {
    const start_line = normalized.start_line
    const end_line = normalized.end_line
    const content = normalized.content

    if (typeof start_line !== 'number' || typeof end_line !== 'number' || typeof content !== 'string') {
      return {
        ok: false,
        normalized,
        error: 'Line mode requires start_line, end_line, and content',
      }
    }

    if (start_line > end_line) {
      return {
        ok: false,
        normalized,
        error: 'start_line must be <= end_line',
      }
    }

    return {
      ok: true,
      mode: 'line',
      normalized,
      args: {
        path: typeof normalized.path === 'string' ? normalized.path : undefined,
        start_line,
        end_line,
        content,
      },
    }
  }

  const edits = normalized.edits
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      ok: false,
      normalized,
      error: 'Batch mode requires non-empty edits array',
    }
  }

  const parsedEdits: EditFileBatchEdit[] = []
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
      return {
        ok: false,
        normalized,
        error: `Edit ${i}: action must be "replace", "insert", or "delete"`,
      }
    }

    const candidate = edit as Record<string, unknown>
    const action = candidate.action
    if (action !== 'replace' && action !== 'insert' && action !== 'delete') {
      return {
        ok: false,
        normalized,
        error: `Edit ${i}: action must be "replace", "insert", or "delete"`,
      }
    }

    const parsedEdit: EditFileBatchEdit = { action }

    if (action === 'replace' || action === 'delete') {
      if (typeof candidate.start_line !== 'number' || typeof candidate.end_line !== 'number') {
        return {
          ok: false,
          normalized,
          error: `Edit ${i}: ${action} requires start_line and end_line`,
        }
      }
      if (candidate.start_line > candidate.end_line) {
        return {
          ok: false,
          normalized,
          error: `Edit ${i}: start_line must be <= end_line`,
        }
      }

      parsedEdit.start_line = candidate.start_line
      parsedEdit.end_line = candidate.end_line
    }

    if (action === 'insert') {
      if (typeof candidate.after_line !== 'number') {
        return {
          ok: false,
          normalized,
          error: `Edit ${i}: insert requires after_line`,
        }
      }
      parsedEdit.after_line = candidate.after_line
    }

    if ((action === 'replace' || action === 'insert') && typeof candidate.content !== 'string') {
      return {
        ok: false,
        normalized,
        error: `Edit ${i}: ${action} requires content`,
      }
    }

    if (typeof candidate.content === 'string') {
      parsedEdit.content = candidate.content
    }

    parsedEdits.push(parsedEdit)
  }

  return {
    ok: true,
    mode: 'batch',
    normalized,
    args: {
      path: typeof normalized.path === 'string' ? normalized.path : undefined,
      edits: parsedEdits,
    },
  }
}
