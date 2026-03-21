export interface ReadFileSingleArgs {
  path: string
  start_line?: number
  end_line?: number
}

export interface ReadFileMultiArgs {
  paths: string[]
}

export type ReadFileResolution =
  | { ok: true; mode: 'single'; normalized: Record<string, unknown>; args: ReadFileSingleArgs }
  | { ok: true; mode: 'multi'; normalized: Record<string, unknown>; args: ReadFileMultiArgs }
  | { ok: false; normalized: Record<string, unknown>; error: string }

function parsePathValue(path: unknown): string | string[] | undefined {
  if (Array.isArray(path) && path.every((item) => typeof item === 'string')) {
    return path
  }

  if (typeof path !== 'string') {
    return undefined
  }

  const trimmed = path.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed
      }
    } catch {
      // Fall back to the raw string path.
    }
  }

  return path
}

export function normalizeReadFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }
  const parsedPath = parsePathValue(normalized.path)

  if (Array.isArray(parsedPath)) {
    normalized.path = parsedPath
    delete normalized.start_line
    delete normalized.end_line
  } else if (typeof parsedPath === 'string') {
    normalized.path = parsedPath
  }

  return normalized
}

export function resolveReadFileRequest(data: Record<string, unknown>): ReadFileResolution {
  const normalized = normalizeReadFileArgs(data)
  const parsedPath = normalized.path

  if (Array.isArray(parsedPath)) {
    if (parsedPath.length === 0) {
      return { ok: false, normalized, error: 'path array must not be empty' }
    }

    return {
      ok: true,
      mode: 'multi',
      normalized,
      args: { paths: parsedPath },
    }
  }

  if (typeof parsedPath !== 'string' || parsedPath.length === 0) {
    return { ok: false, normalized, error: 'path is required' }
  }

  const start_line = normalized.start_line
  const end_line = normalized.end_line

  if (start_line !== undefined && typeof start_line !== 'number') {
    return { ok: false, normalized, error: 'start_line must be a number' }
  }

  if (end_line !== undefined && typeof end_line !== 'number') {
    return { ok: false, normalized, error: 'end_line must be a number' }
  }

  if (typeof start_line === 'number' && typeof end_line === 'number' && start_line > end_line) {
    return { ok: false, normalized, error: 'start_line must be <= end_line' }
  }

  return {
    ok: true,
    mode: 'single',
    normalized,
    args: {
      path: parsedPath,
      ...(typeof start_line === 'number' ? { start_line } : {}),
      ...(typeof end_line === 'number' ? { end_line } : {}),
    },
  }
}
