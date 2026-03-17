/**
 * 工具统一配置
 * 
 * 设计参考：Claude Code CLI, Codex CLI, Kiro
 * 
 * 单一数据源：所有工具的定义、schema、元数据、提示词描述都从这里生成
 * 添加新工具只需在 TOOL_CONFIGS 中添加一项
 */

import { z } from 'zod'
import type { ToolApprovalType } from '@/shared/types/llm'

// ============================================
// 类型定义
// ============================================

export type ToolCategory = 'read' | 'write' | 'terminal' | 'search' | 'lsp' | 'network' | 'interaction' | 'orchestrator'

export interface ToolPropertyDef {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description: string
    required?: boolean
    default?: unknown
    enum?: string[]
    items?: ToolPropertyDef
    properties?: Record<string, ToolPropertyDef>
}

export interface ToolConfig {
    name: string
    displayName: string
    /** 简短描述（用于 LLM 工具定义） */
    description: string
    /** 详细描述（用于系统提示词） */
    detailedDescription?: string
    /** 使用示例 */
    examples?: string[]
    /** 重要提示（CRITICAL/IMPORTANT 级别的规则） */
    criticalRules?: string[]
    /** 常见错误及解决方案 */
    commonErrors?: Array<{ error: string; solution: string }>
    category: ToolCategory
    approvalType: ToolApprovalType
    parallel: boolean
    requiresWorkspace: boolean
    enabled: boolean
    parameters: Record<string, ToolPropertyDef>
    /** 自定义 Zod schema（可选，用于复杂验证） */
    customSchema?: z.ZodSchema
    /** 自定义验证函数 */
    validate?: (data: Record<string, unknown>) => { valid: boolean; error?: string }
}

// ============================================
// 工具配置
// ============================================

export const TOOL_CONFIGS: Record<string, ToolConfig> = {
    // ===== 读取类工具 =====
    read_file: {
        name: 'read_file',
        displayName: 'Read File',
        description: 'Read one or more files with line numbers. Pass a single path string or an array of paths. For large files, use start_line/end_line. MUST read before editing.',
        detailedDescription: `Read file contents from the filesystem with line numbers (1-indexed).
- Single file: path="src/main.ts"
- Multiple files: path=["src/a.ts", "src/b.ts"]
- Large files will be truncated, use search_files to locate target first`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'File path string OR JSON array of paths. Single: "src/main.ts". Multiple: ["src/a.ts", "src/b.ts"]. start_line/end_line only apply to single-file reads.',
                required: true
            },
            start_line: { type: 'number', description: 'Starting line (1-indexed, single file only)' },
            end_line: { type: 'number', description: 'Ending line inclusive (single file only)' },
        },
        validate: (data) => {
            if (data.start_line && data.end_line && (data.start_line as number) > (data.end_line as number)) {
                return { valid: false, error: 'start_line must be <= end_line' }
            }
            return { valid: true }
        },
    },

    list_directory: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: 'List directory contents. Use recursive=true for tree view of subdirectories. Use recursive=false (default) for single level.',
        detailedDescription: `List directory contents with file types and sizes.
- Non-recursive: shows immediate children only
- Recursive: shows full tree up to max_depth`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for workspace root', required: true },
            recursive: { type: 'boolean', description: 'Show subdirectories recursively (default: false)', default: false },
            max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)', default: 3 },
        },
    },

    // ===== 搜索工具 =====
    search_files: {
        name: 'search_files',
        displayName: 'Search Files',
        description: 'Search for text or regex patterns in files. Can search a directory or single file. Use | to combine multiple patterns in one call (e.g., "pattern1|pattern2"). For semantic search, use codebase_search instead.',
        detailedDescription: `Fast content search using ripgrep-style matching.
- Supports regex patterns with is_regex=true
- Use | to combine multiple patterns
- Can search single file by providing file path`,
        examples: [
            'search_files path="src" pattern="TODO|FIXME|HACK" is_regex=true',
            'search_files path="src/app.tsx" pattern="useState|useEffect" is_regex=true',
        ],
        criticalRules: [
            'Combine multiple patterns with | - NEVER make separate calls',
            'For single file, use file path directly as path parameter',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'Directory OR file path relative to workspace root. Defaults to "." (workspace root).',
                default: '.'
            },
            pattern: { type: 'string', description: 'Pattern. Combine multiple with | (e.g., "pat1|pat2|pat3")', required: true },
            is_regex: { type: 'boolean', description: 'Enable regex (auto-enabled for | patterns)', default: false },
            file_pattern: { type: 'string', description: 'Filter files (e.g., "*.ts")' },
        },
    },

    codebase_search: {
        name: 'codebase_search',
        displayName: 'Semantic Search',
        description: 'AI-powered semantic search for finding code by meaning. Use for conceptual queries like "where is authentication handled". For exact text search, use search_files instead.',
        detailedDescription: `AI-powered semantic search for finding related code by meaning.
- Understands natural language queries
- Ask complete questions for best results`,
        examples: [
            'codebase_search query="user authentication logic"',
        ],
        criticalRules: [
            'Use complete questions for best results',
            'For exact text, use search_files instead',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Natural language query - ask complete question', required: true },
            top_k: { type: 'number', description: 'Number of results (default: 10)', default: 10 },
        },
    },

    // ===== 编辑类工具 =====
    edit_file: {
        name: 'edit_file',
        displayName: 'Edit File',
        description: `Edit an existing file. Choose EXACTLY ONE mode — NEVER mix parameters from different modes:
- **String mode**: provide \`old_string\` + \`new_string\` only. Do NOT add start_line/end_line/content.
- **Line mode**: provide \`start_line\` + \`end_line\` + \`content\` only. Do NOT add old_string/new_string.
- **Batch mode**: provide \`edits\` array only. Do NOT add any other mode parameters.
CRITICAL: Read the file first. NEVER pass parameters from two different modes in the same call.`,
        detailedDescription: `Three mutually exclusive editing modes:
- String mode: old_string + new_string (include 3-5 lines context around the change)
- Line mode: start_line + end_line + content (use exact line numbers from read_file)
- Batch mode: edits=[{action, start_line, end_line, content}, ...] (auto-sorted, prevents line number shifts)`,
        commonErrors: [
            { error: 'old_string not found', solution: 'Read file again, copy exact content including whitespace' },
            { error: 'Multiple matches', solution: 'Include more surrounding context lines in old_string' },
            { error: 'Overlapping edits', solution: 'Ensure edit ranges do not overlap' },
            { error: 'Cannot mix string mode, line mode, and batch mode', solution: 'Use ONLY one mode per call: either old_string+new_string OR start_line+end_line+content OR edits array' },
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root', required: true },
            old_string: { type: 'string', description: '[STRING MODE ONLY] Exact text to find — include 3-5 lines of context. Do NOT use together with start_line/end_line/content/edits.' },
            new_string: { type: 'string', description: '[STRING MODE ONLY] Replacement text. Do NOT use together with start_line/end_line/content/edits.' },
            start_line: { type: 'number', description: '[LINE MODE ONLY] First line to replace (1-indexed). Do NOT use together with old_string/new_string/edits.' },
            end_line: { type: 'number', description: '[LINE MODE ONLY] Last line to replace (inclusive). Do NOT use together with old_string/new_string/edits.' },
            content: { type: 'string', description: '[LINE MODE ONLY] New content for the line range. Do NOT use together with old_string/new_string/edits.' },
            replace_all: { type: 'boolean', description: '[STRING MODE ONLY] Replace all occurrences instead of just the first', default: false },
            edits: {
                type: 'array',
                description: 'Batch edits array (batch mode). Each edit: {action: "replace"|"insert"|"delete", start_line?, end_line?, after_line?, content?}. Auto-sorted to prevent line shifts.',
                items: {
                    type: 'object',
                    description: 'Individual edit operation',
                    properties: {
                        action: { type: 'string', description: 'Action type ("replace", "insert", "delete")', enum: ['replace', 'insert', 'delete'] },
                        start_line: { type: 'number', description: 'Start line (1-indexed, required for replace/delete)' },
                        end_line: { type: 'number', description: 'End line (inclusive, required for replace/delete)' },
                        after_line: { type: 'number', description: 'Line after which to insert (required for insert)' },
                        content: { type: 'string', description: 'New content (required for replace/insert)' }
                    }
                }
            },
        },
        validate: (data) => {
            // 模式判定：content 单独存在时不算 line mode，避免 AI 在 string mode 下顺带传 content 触发误报
            const hasStringMode = !!(data.old_string !== undefined || data.new_string !== undefined)
            const hasLineMode = !!(data.start_line !== undefined || data.end_line !== undefined)
            const hasBatchMode = !!(data.edits)

            const modeCount = [hasStringMode, hasLineMode, hasBatchMode].filter(Boolean).length
            if (modeCount > 1) {
                return { valid: false, error: 'Cannot mix string mode, line mode, and batch mode parameters' }
            }

            if (modeCount === 0) {
                return { valid: false, error: 'Must provide either (old_string + new_string), (start_line + end_line + content), or (edits array)' }
            }

            // 验证字符串模式
            if (hasStringMode && (!data.old_string || data.new_string === undefined)) {
                return { valid: false, error: 'String mode requires both old_string and new_string' }
            }

            // 验证行模式
            if (hasLineMode) {
                if (!data.start_line || !data.end_line || data.content === undefined) {
                    return { valid: false, error: 'Line mode requires start_line, end_line, and content' }
                }
                if ((data.start_line as number) > (data.end_line as number)) {
                    return { valid: false, error: 'start_line must be <= end_line' }
                }
            }

            // 验证批量模式
            if (hasBatchMode) {
                if (!Array.isArray(data.edits) || data.edits.length === 0) {
                    return { valid: false, error: 'Batch mode requires non-empty edits array' }
                }

                for (let i = 0; i < data.edits.length; i++) {
                    const edit = data.edits[i]
                    if (!edit.action || !['replace', 'insert', 'delete'].includes(edit.action)) {
                        return { valid: false, error: `Edit ${i}: action must be "replace", "insert", or "delete"` }
                    }

                    if (edit.action === 'replace' || edit.action === 'delete') {
                        if (!edit.start_line || !edit.end_line) {
                            return { valid: false, error: `Edit ${i}: ${edit.action} requires start_line and end_line` }
                        }
                        if (edit.start_line > edit.end_line) {
                            return { valid: false, error: `Edit ${i}: start_line must be <= end_line` }
                        }
                    }

                    if (edit.action === 'insert') {
                        if (edit.after_line === undefined) {
                            return { valid: false, error: `Edit ${i}: insert requires after_line` }
                        }
                    }

                    if ((edit.action === 'replace' || edit.action === 'insert') && edit.content === undefined) {
                        return { valid: false, error: `Edit ${i}: ${edit.action} requires content` }
                    }
                }
            }

            return { valid: true }
        },
    },

    write_file: {
        name: 'write_file',
        displayName: 'Write File',
        description: 'Write complete content to a file. Use for: (1) creating a new file, (2) completely rewriting an existing file. WARNING: overwrites all existing content. For partial changes to an existing file, use edit_file instead.',
        criticalRules: [
            'OVERWRITES entire file — use edit_file for any partial change',
            'Prefer over create_file_or_folder when you have file content ready',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/new.ts")', required: true },
            content: { type: 'string', description: 'Complete file content', required: true },
        },
    },

    create_file_or_folder: {
        name: 'create_file_or_folder',
        displayName: 'Create',
        description: 'Create file or folder. Path ending with / creates folder.',
        detailedDescription: `Create new files or directories.
- Path ending with "/" creates folder
- Can include initial content for files`,
        examples: [
            'create_file_or_folder path="src/utils/"',
            'create_file_or_folder path="src/config.ts" content="export default {}"',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root (end with / for folder, e.g., "src/utils/" or "src/config.ts")', required: true },
            content: { type: 'string', description: 'Initial content for files' },
        },
    },

    delete_file_or_folder: {
        name: 'delete_file_or_folder',
        displayName: 'Delete',
        description: 'Delete file or folder. Requires approval.',
        detailedDescription: `Delete files or directories.
- Requires user approval
- Use recursive=true for non-empty folders`,
        criticalRules: [
            'DESTRUCTIVE - requires approval',
        ],
        category: 'write',
        approvalType: 'dangerous',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root to delete (e.g., "src/old.ts")', required: true },
            recursive: { type: 'boolean', description: 'REQUIRED for non-empty folders. If false (default) and the folder has contents, deletion will fail. Always set true when deleting a folder.', default: false },
        },
    },

    // ===== 终端工具 =====
    run_command: {
        name: 'run_command',
        displayName: 'Run Command',
        description: 'Execute shell command. Requires user approval. Use cwd parameter to set working directory. Do NOT use for reading files (use read_file), searching (use search_files), or editing (use edit_file).',
        detailedDescription: `Execute shell commands in workspace.
- Requires user approval
- Use cwd parameter instead of cd commands
For long-running servers or watch tasks:
- Set is_background=true to run in a UI terminal panel
- The command returns a terminal ID immediately
- Use read_terminal_output to check logs
- Use send_terminal_input to interact (e.g. typing 'y' or sending Ctrl+C)
- Use stop_terminal to kill it later`,
        examples: [
            'run_command command="npm install"',
            'run_command command="npm test" cwd="packages/core"',
            'run_command command="npm run dev" is_background=true',
        ],
        criticalRules: [
            'NEVER use cat/grep/sed - use dedicated tools',
            'Use cwd parameter instead of cd — NEVER write "cd path && command" or "cd path; command" inside command field',
            'NEVER use && in command — it is not supported on Windows PowerShell 5 (use cwd parameter for directory changes)',
            'Always use is_background=true for servers and dev tasks',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            command: { type: 'string', description: 'Shell command', required: true },
            cwd: { type: 'string', description: 'Working directory relative to workspace root (e.g., "packages/core", NOT "./packages/core")', },
            timeout: { type: 'number', description: 'Timeout seconds (default: 60). Increase for slow commands like installs.', default: 60 },
            is_background: { type: 'boolean', description: 'Run in background as a visible UI terminal. Required for long-running processes like servers or watchers.', default: false },
        },
    },

    read_terminal_output: {
        name: 'read_terminal_output',
        displayName: 'Read Terminal',
        description: 'Read the output buffer of a background UI terminal.',
        detailedDescription: `Get the recent output lines of a running terminal.
- Use the terminal ID returned from a background run_command
- By default returns the last 100 lines`,
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to read from', required: true },
            lines: { type: 'number', description: 'Number of recent lines to read (default 100)', default: 100 },
        },
    },

    send_terminal_input: {
        name: 'send_terminal_input',
        displayName: 'Terminal Input',
        description: 'Send text input or keystrokes to a background UI terminal.',
        detailedDescription: `Send keystrokes to an interactive terminal.
- Supports raw text or special keys
- Required for answering prompts (e.g., Y/N) in commands
- Set is_ctrl=true to send combinations like Ctrl+C`,
        category: 'terminal',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to send input to', required: true },
            input: { type: 'string', description: 'Text to send. For regular text/answers: "yes\\n", "Y\\n". For Ctrl combos: MUST be a single letter (e.g. "c" for Ctrl+C, "d" for Ctrl+D, "z" for Ctrl+Z) — only used when is_ctrl=true.', required: true },
            is_ctrl: { type: 'boolean', description: 'If true, sends input as a Ctrl key combo. input MUST be a single character (e.g. is_ctrl=true, input="c" → Ctrl+C). Default: false.', default: false },
        },
    },

    stop_terminal: {
        name: 'stop_terminal',
        displayName: 'Stop Terminal',
        description: 'Stop a background UI terminal process and close its panel.',
        detailedDescription: `Kill a terminal process and cleanup UI.
- Use this when a dev server or watcher is no longer needed`,
        category: 'terminal',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to stop', required: true },
        },
    },

    // ===== LSP 工具 =====
    get_lint_errors: {
        name: 'get_lint_errors',
        displayName: 'Lint Errors',
        description: 'Get TypeScript/ESLint errors for a file. Use after editing to verify code. If results seem stale, pass refresh=true to force re-check.',
        detailedDescription: `Get diagnostics (errors, warnings) for a file.
- Shows TypeScript/ESLint errors
- Use after editing to verify code
- Use refresh=true if results seem outdated`,
        criticalRules: [
            'Call once after editing, not repeatedly',
            'If errors persist after a fix, use refresh=true to force re-check',
        ],
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root to check (e.g., "src/main.ts")', required: true },
            refresh: { type: 'boolean', description: 'Force re-check instead of using cached diagnostics (default: false)', default: false },
        },
    },

    find_references: {
        name: 'find_references',
        displayName: 'Find References',
        description: 'Find all references to a symbol across the codebase. TIP: Use read_file to see the line/column of the symbol first, or use get_document_symbols to find symbol positions.',
        detailedDescription: `Find all usages of a symbol across codebase.
- Requires exact file position (line, column)
- To find the position: use read_file and note the line number, column is the 1-indexed character offset within the line
- Or use get_document_symbols to list all symbols with their positions
- Useful for refactoring`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    go_to_definition: {
        name: 'go_to_definition',
        displayName: 'Go to Definition',
        description: 'Get the definition location of a symbol. TIP: Use read_file to find the line/column where the symbol is used, or use get_document_symbols to list positions.',
        detailedDescription: `Navigate to where a symbol is defined.
- To find position: read_file and note line number; column is 1-indexed character offset within the line
- Or use get_document_symbols to find symbol positions in a file`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    get_hover_info: {
        name: 'get_hover_info',
        displayName: 'Hover Info',
        description: 'Get type info and documentation for a symbol at a position. TIP: Use read_file to find the line/column, or get_document_symbols for symbol positions.',
        detailedDescription: `Get TypeScript type info, signatures, and JSDoc for a symbol.
- To find position: read_file and note line number; column is 1-indexed character offset within the line
- Useful for understanding unfamiliar types or APIs`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    get_document_symbols: {
        name: 'get_document_symbols',
        displayName: 'Document Symbols',
        description: 'List all functions, classes, interfaces, and variables defined in a file. Use to understand file structure.',
        detailedDescription: `List all symbols defined in a file.
- Shows functions, classes, interfaces, variables`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
        },
    },



    // ===== 网络工具 =====
    web_search: {
        name: 'web_search',
        displayName: 'Web Search',
        description: 'Search the web for information. Use ONE comprehensive search query instead of multiple separate searches.',
        detailedDescription: `Search the web using Google or DuckDuckGo.

IMPORTANT GUIDELINES:
- Use ONE well-crafted search query that covers your information need
- DO NOT make multiple separate searches for related topics - combine them into one query
- Use specific keywords and phrases for better results
- For technical topics, include version numbers or specific terms
- After getting results, use read_url to get detailed content from relevant pages

GOOD: "React 18 useEffect cleanup function best practices"
BAD: Multiple searches like "React useEffect", "useEffect cleanup", "React best practices"

GOOD: "Python asyncio vs threading performance comparison 2024"
BAD: Separate searches for "Python asyncio" and "Python threading"`,
        category: 'network',
        approvalType: 'none',
        parallel: false,  // 禁止并行，避免多次分散搜索
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: {
                type: 'string',
                description: 'Search query - use ONE comprehensive query with specific keywords. Combine related topics into a single search.',
                required: true,
            },
            max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)', default: 5 },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 30, minimum: 15). Increase for slow networks.', default: 30 },
        },
    },

    read_url: {
        name: 'read_url',
        displayName: 'Read URL',
        description: 'Fetch and read content from a URL. Use after web_search to get detailed information from specific pages.',
        detailedDescription: `Read the content of a web page using Jina Reader for optimized LLM-friendly output.

WHEN TO USE:
- After web_search returns relevant URLs that need detailed reading
- When you have a specific URL from the user or documentation
- To read API documentation, blog posts, or technical articles

TIPS:
- Jina Reader handles JavaScript-rendered pages (SPAs)
- For API endpoints or raw files, content is fetched directly
- Large pages are automatically truncated to 500KB`,
        category: 'network',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)', required: true },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 60, minimum: 30). Use higher values for complex pages.', default: 60 },
        },
    },

    ask_user: {
        name: 'ask_user',
        displayName: 'Ask User',
        description: 'Ask user to select from options to gather requirements or preferences.',
        detailedDescription: `Present interactive options to the user and wait for their selection.
- Use to gather requirements, preferences, or confirmations
- Options are displayed as clickable cards
- Supports single or multiple selection
- The tool blocks until user makes a selection`,
        examples: [
            'ask_user question="What type of task?" options=[{id:"feature",label:"New Feature"},{id:"bugfix",label:"Bug Fix"}]',
            'ask_user question="Which files to modify?" options=[...] multi_select=true',
        ],
        criticalRules: [
            'Use to gather requirements, preferences, or confirmations',
            'Keep options concise and clear',
            'Provide descriptions for complex options',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            question: { type: 'string', description: 'Question to ask the user', required: true },
            options: {
                type: 'array',
                description: 'Options for user to select from',
                required: true,
                items: {
                    type: 'object',
                    description: 'Option item. Use "id" or "value" as unique identifier.',
                    properties: {
                        // id 和 value 都可选，执行器会处理
                        id: { type: 'string', description: 'Unique option ID' },
                        value: { type: 'string', description: 'Alternative to id (will be used as id if id is not provided)' },
                        label: { type: 'string', description: 'Display label', required: true },
                        description: { type: 'string', description: 'Optional description' },
                    },
                },
            },
            multi_select: { type: 'boolean', description: 'Allow selecting multiple options (default: false)', default: false },
        },
    },

    create_task_plan: {
        name: 'create_task_plan',
        displayName: 'Create Task Plan',
        description: 'Create a structured task plan with requirements document and task list.',
        detailedDescription: `Generate a task plan file that will be displayed in the TaskBoard.
- Creates a plan file in .adnify/plan/ directory
- Automatically opens the TaskBoard tab
- Each task includes suggested provider/model/role
- User can modify assignments before execution`,
        examples: [
            'create_task_plan name="Login Page" requirementsDoc="..." tasks=[{title:"Create form",suggestedProvider:"anthropic",suggestedModel:"claude-sonnet-4",suggestedRole:"coder"}]',
        ],
        criticalRules: [
            'Always gather requirements with ask_user before creating a plan',
            'Break complex requests into atomic tasks',
            'Suggest appropriate models based on task complexity',
            'Include clear task descriptions',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            name: { type: 'string', description: 'Human-readable name for the plan', required: true },
            requirementsDoc: { type: 'string', description: 'Markdown formatted requirements document', required: true },
            tasks: {
                type: 'array',
                description: 'List of tasks to execute',
                required: true,
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Detailed task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Recommended provider', required: true, enum: ['anthropic', 'openai', 'gemini', 'ollama'] },
                        suggestedModel: { type: 'string', description: 'Recommended model ID (e.g., "claude-sonnet-4-6", "gpt-4o", "gemini-2.0-flash")', required: true },
                        suggestedRole: { type: 'string', description: 'Recommended role/persona (e.g., "coder", "reviewer", "planner", "tester")', required: true },
                        dependencies: { type: 'array', description: 'IDs of tasks this depends on', items: { type: 'string', description: 'Task ID' } },
                    },
                },
            },
            executionMode: { type: 'string', description: 'Default execution mode: sequential or parallel', enum: ['sequential', 'parallel'], default: 'sequential' },
        },
    },

    update_task_plan: {
        name: 'update_task_plan',
        displayName: 'Update Task Plan',
        description: 'Update an existing task plan based on user feedback. Can modify requirements, add/remove/update tasks.',
        detailedDescription: `Use this tool to modify an existing task plan when user requests changes.
You can:
- Update the requirements document
- Add new tasks
- Remove existing tasks
- Modify task details (title, description, model, role)
- Change execution mode`,
        examples: [
            'update_task_plan planId="login-1234" updateRequirements="增加密码强度验证" addTasks=[{title: "密码验证", ...}]',
            'update_task_plan planId="login-1234" removeTasks=["task-001"]',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID to update', required: true },
            updateRequirements: { type: 'string', description: 'Additional requirements to append (markdown)' },
            addTasks: {
                type: 'array',
                description: 'New tasks to add',
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Provider' },
                        suggestedModel: { type: 'string', description: 'Model' },
                        suggestedRole: { type: 'string', description: 'Role' },
                        insertAfter: { type: 'string', description: 'Insert after this task ID' },
                    },
                },
            },
            removeTasks: {
                type: 'array',
                description: 'Task IDs to remove',
                items: { type: 'string', description: 'Task ID to remove' },
            },
            updateTasks: {
                type: 'array',
                description: 'Tasks to update',
                items: {
                    type: 'object',
                    description: 'Task update',
                    properties: {
                        taskId: { type: 'string', description: 'Task ID', required: true },
                        title: { type: 'string', description: 'New title' },
                        description: { type: 'string', description: 'New description' },
                        provider: { type: 'string', description: 'New provider' },
                        model: { type: 'string', description: 'New model' },
                        role: { type: 'string', description: 'New role' },
                    },
                },
            },
            executionMode: { type: 'string', description: 'New execution mode', enum: ['sequential', 'parallel'] },
        },
    },

    start_task_execution: {
        name: 'start_task_execution',
        displayName: 'Start Task Execution',
        description: 'Start executing tasks in the active plan. Call this when user confirms they want to proceed.',
        detailedDescription: `Use this tool when user says things like:
- "开始执行"
- "执行" / "run"
- "开始" / "start"
- "Go ahead" / "Proceed"

This will trigger the task executor to run through the plan.`,
        examples: [
            'start_task_execution',
            'start_task_execution planId="login-1234"',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID (optional, uses active plan if not specified)' },
        },
    },

    // ===== UI/UX 设计工具 =====
    uiux_search: {
        name: 'uiux_search',
        displayName: 'UI/UX Search',
        description: 'Search UI/UX design database for styles, colors, typography, icons, performance tips, and best practices.',
        detailedDescription: `Search the design knowledge base for:
- UI styles (glassmorphism, minimalism, etc.)
- Color palettes for different industries
- Typography and font pairings
- Chart recommendations
- Landing page patterns
- UX best practices
- Icon sets and recommendations
- React performance optimization
- UI reasoning and decision making
- Web interface components`,
        examples: [
            'uiux_search query="glassmorphism" domain="style"',
            'uiux_search query="saas dashboard" domain="color"',
            'uiux_search query="elegant font" domain="typography"',
            'uiux_search query="lucide heroicons" domain="icons"',
            'uiux_search query="memo optimization" domain="react-performance"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Search keywords', required: true },
            domain: {
                type: 'string',
                description: 'Search domain (auto-detected if not specified)',
                enum: ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt', 'icons', 'react-performance', 'ui-reasoning', 'web-interface'],
            },
            stack: {
                type: 'string',
                description: 'Tech stack for stack-specific guidelines',
                enum: ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter', 'jetpack-compose', 'nuxt-ui', 'nuxtjs', 'shadcn'],
            },
            max_results: { type: 'number', description: 'Maximum results (default: 3)', default: 3 },
        },
    },

    uiux_recommend: {
        name: 'uiux_recommend',
        displayName: 'UI/UX Recommend',
        description: 'Get a complete design system recommendation for a product type, including style, colors, typography, and landing page pattern.',
        detailedDescription: `Input a product type and get a cohesive design recommendation:
- Recommended UI style with CSS/Tailwind keywords
- Color palette with hex values
- Typography pairing with Google Fonts
- Landing page pattern suggestion
- Key design considerations`,
        examples: [
            'uiux_recommend product_type="saas"',
            'uiux_recommend product_type="e-commerce luxury"',
            'uiux_recommend product_type="healthcare app"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            product_type: { type: 'string', description: 'Product type (e.g., saas, e-commerce, fintech, healthcare)', required: true },
        },
    },

    remember: {
        name: 'remember',
        displayName: 'Remember',
        description: 'Save a project-level fact or preference so it persists across all future conversations. Use proactively when you discover something important that should not be re-discovered every session.',
        detailedDescription: `Persist important project knowledge across conversations.

PROACTIVELY use remember when you discover:
- Architectural decisions ("Uses Zustand for global state, not Redux")
- Tech stack specifics ("Node version pinned to 18.x in .nvmrc")
- Recurring bugs and their root causes ("navigator.userAgent instead of process.platform in renderer")
- User code style preferences ("Prefer functional components, no class components")
- Project conventions ("All API calls go through src/services/, never directly in components")
- Environment quirks ("Windows PowerShell is default shell, use ; not &&")

Don't wait for the user to ask — if you learn something that would save time in future sessions, remember it.`,
        examples: [
            'remember content="Uses pnpm workspaces. Always run install from root, not individual packages."',
            'remember content="User prefers snake_case for all tool/API parameter names."',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            content: { type: 'string', description: 'The fact, preference, or convention to remember. Write as a clear, standalone statement that will make sense without conversation context.', required: true },
        },
    },

    // ===== Skill 工具 =====
    apply_skill: {
        name: 'apply_skill',
        displayName: 'Apply Skill',
        description: 'Load a project skill by name when it is directly relevant to the current task.',
        detailedDescription: `Load a project-specific skill's full content (instructions, guidelines, templates) by name.

Available skills are listed in the system prompt under "Available Skills". Each skill has a name and description.
- Do NOT eagerly apply skills — only when the user's task DIRECTLY requires the skill's domain knowledge
- General coding, bug fixes, or simple questions do NOT need skills, even if tangentially related
- The tool returns the full skill content which you should follow as project-specific instructions`,
        category: 'interaction',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            skill_name: { type: 'string', description: 'The name of the skill to load (as shown in Available Skills list)', required: true },
        },
    },
}



// ============================================
// 工具选择决策指南
// ============================================

/**
 * 文件编辑工具选择决策树
 * 根据场景选择最合适的工具
 */
export const FILE_EDIT_DECISION_GUIDE = `
## File Editing Decision Guide

**Which tool to use:**
1. NEW file that doesn't exist → \`write_file\` or \`create_file_or_folder\`
2. REPLACE ENTIRE file content → \`write_file\`
3. Edit part of an existing file → \`edit_file\` (choose one mode below)

**edit_file modes — pick EXACTLY ONE, NEVER mix:**
| You have... | Use mode | Parameters |
|-------------|----------|------------|
| Exact text to find/replace | String mode | \`old_string\` + \`new_string\` |
| Exact line numbers (from read_file) | Line mode | \`start_line\` + \`end_line\` + \`content\` |
| Multiple non-overlapping edits | Batch mode | \`edits\` array |

**⚠️ CRITICAL RULE: Each call to edit_file must use ONLY ONE mode.**
- String mode: old_string + new_string → DO NOT add start_line/end_line/content
- Line mode: start_line + end_line + content → DO NOT add old_string/new_string
- Batch mode: edits array → DO NOT add any other parameters
`

/**
 * 搜索工具选择决策指南
 */
export const SEARCH_DECISION_GUIDE = `
## Search Tool Selection

**Decision Tree:**
1. Looking for a CONCEPT or MEANING (e.g., "authentication logic")?
   → Use \`codebase_search\` (semantic/AI search)

2. Looking for EXACT TEXT or PATTERN?
   → Use \`search_files\` (text/regex search)
   → For multiple patterns, combine with | (e.g., "pattern1|pattern2|pattern3")

3. Searching within a SINGLE FILE?
   → Use \`search_files\` with file path as path parameter
   → Example: search_files path="src/styles.css" pattern="button|card"

4. Looking for FILES BY NAME/PATTERN?
   → Use \`list_directory\` or \`get_dir_tree\`

**NEVER use bash grep/find - use these tools instead.**

**ANTI-FRAGMENTATION:**
- Combine multiple patterns with | instead of making multiple calls
- Use read_multiple_files instead of multiple read_file calls
`

// ============================================
// 生成器函数
// ============================================

import type { ToolDefinition, ToolPropertySchema } from '@/shared/types/llm'

/** 将 ToolPropertyDef 转换为 ToolPropertySchema */
function convertToPropertySchema(prop: ToolPropertyDef): ToolPropertySchema {
    const schema: ToolPropertySchema = {
        type: prop.type,
        description: prop.description,
    }
    if (prop.enum) schema.enum = prop.enum
    if (prop.items) schema.items = convertToPropertySchema(prop.items)
    if (prop.properties) {
        schema.properties = Object.fromEntries(
            Object.entries(prop.properties).map(([k, v]) => [k, convertToPropertySchema(v)])
        )
    }
    return schema
}

/** 生成 LLM 工具定义 */
export function generateToolDefinition(config: ToolConfig): ToolDefinition {
    const properties: Record<string, ToolPropertySchema> = {}
    const required: string[] = []

    for (const [key, prop] of Object.entries(config.parameters)) {
        properties[key] = convertToPropertySchema(prop)
        if (prop.required) {
            required.push(key)
        }
    }

    return {
        name: config.name,
        description: config.description,
        ...(config.approvalType !== 'none' && { approvalType: config.approvalType }),
        parameters: {
            type: 'object',
            properties,
            required,  // Anthropic 要求 required 必须是数组，即使为空
        },
    }
}

// ============================================
// Zod 预处理辅助函数 (增强容错性)
// ============================================

const preprocessNumber = (val: unknown) => {
    if (typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val)
        return isNaN(parsed) ? val : parsed
    }
    return val
}

const preprocessBoolean = (val: unknown) => {
    if (typeof val === 'string') {
        const lower = val.toLowerCase()
        if (lower === 'true') return true
        if (lower === 'false') return false
    }
    return val
}

const preprocessArray = (val: unknown) => {
    if (typeof val === 'string') {
        try {
            return JSON.parse(val)
        } catch {
            return val
        }
    }
    return val
}

/** 递归生成 Zod Schema (支持嵌套和自动类型转换) */
function createZodType(prop: ToolPropertyDef): z.ZodTypeAny {
    switch (prop.type) {
        case 'string':
            if (prop.enum) {
                return z.enum(prop.enum as [string, ...string[]])
            }
            return z.string()
        case 'number':
            return z.preprocess(preprocessNumber, z.number().int())
        case 'boolean':
            return z.preprocess(preprocessBoolean, z.boolean())
        case 'array':
            let itemSchema: z.ZodTypeAny = z.any()
            if (prop.items) {
                itemSchema = createZodType(prop.items)
            }
            return z.preprocess(preprocessArray, z.array(itemSchema))
        case 'object':
            if (prop.properties) {
                const shape: Record<string, z.ZodTypeAny> = {}
                for (const [k, v] of Object.entries(prop.properties)) {
                    let s = createZodType(v)
                    if (!v.required) s = s.optional()
                    shape[k] = s
                }
                return z.object(shape).passthrough()
            }
            return z.object({}).passthrough()
        default:
            return z.any()
    }
}

/** 生成 Zod Schema */
export function generateZodSchema(config: ToolConfig): z.ZodSchema {
    if (config.customSchema) {
        return config.customSchema
    }

    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, prop] of Object.entries(config.parameters)) {
        let schema = createZodType(prop)

        // 重新应用顶层的 required 验证消息
        if (prop.type === 'string' && prop.required && !prop.enum) {
            schema = z.string().min(1, `${key} is required`)
        }

        if (!prop.required) {
            schema = schema.optional()
            if (prop.default !== undefined) {
                schema = schema.default(prop.default)
            }
        }

        shape[key] = schema
    }

    // 使用 passthrough() 允许额外的字段（如 _meta）
    const objectSchema = z.object(shape).passthrough()

    // 添加自定义验证
    if (config.validate) {
        return objectSchema.refine(
            (data) => config.validate!(data).valid,
            (data) => ({ message: config.validate!(data).error || 'Validation failed' })
        )
    }

    return objectSchema
}

// ============================================
// 生成系统提示词中的工具描述
// ============================================

/**
 * 生成单个工具的详细提示词描述
 * 
 * 使用 description 作为主要描述（包含反碎片化规则）
 */
export function generateToolPromptDescription(config: ToolConfig): string {
    const lines: string[] = []

    // 工具名
    lines.push(`### ${config.displayName} (\`${config.name}\`)`)

    // 主描述（包含反碎片化规则）
    lines.push(config.description)
    lines.push('')

    // 详细描述（补充使用细节）
    if (config.detailedDescription) {
        lines.push(config.detailedDescription)
        lines.push('')
    }

    // 关键规则
    if (config.criticalRules && config.criticalRules.length > 0) {
        lines.push('**Rules:**')
        for (const rule of config.criticalRules) {
            lines.push(`- ${rule}`)
        }
        lines.push('')
    }

    // 参数
    const params = Object.entries(config.parameters)
    if (params.length > 0) {
        lines.push('**Parameters:**')
        for (const [key, prop] of params) {
            const required = prop.required ? '(required)' : '(optional)'
            const defaultVal = prop.default !== undefined ? ` [default: ${prop.default}]` : ''
            lines.push(`- \`${key}\` ${required}: ${prop.description}${defaultVal}`)
        }
        lines.push('')
    }

    // 常见错误
    if (config.commonErrors && config.commonErrors.length > 0) {
        lines.push('**Common Errors:**')
        for (const err of config.commonErrors) {
            lines.push(`- "${err.error}" → ${err.solution}`)
        }
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 生成工具提示词描述（可排除指定类别和指定工具）
 * 
 * @param excludeCategories 要排除的工具类别
 * @param allowedTools 允许的工具列表（如果提供，只包含这些工具）
 */
export function generateToolsPromptDescriptionFiltered(
    excludeCategories: ToolCategory[] = [],
    allowedTools?: string[]
): string {
    const categories: Record<ToolCategory, ToolConfig[]> = {
        read: [],
        search: [],
        write: [],
        terminal: [],
        lsp: [],
        network: [],
        interaction: [],
        orchestrator: [],
    }

    // 按类别分组
    for (const config of Object.values(TOOL_CONFIGS)) {
        // 检查是否启用、类别是否被排除、是否在允许列表中
        const isEnabled = config.enabled
        const categoryAllowed = !excludeCategories.includes(config.category)
        const toolAllowed = !allowedTools || allowedTools.includes(config.name)

        if (isEnabled && categoryAllowed && toolAllowed) {
            categories[config.category].push(config)
        }
    }

    const sections: string[] = []

    if (categories.read.length > 0) {
        sections.push('## File Reading Tools')
        for (const config of categories.read) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.search.length > 0) {
        sections.push('## Search Tools')
        sections.push(SEARCH_DECISION_GUIDE)
        for (const config of categories.search) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.write.length > 0) {
        sections.push('## File Editing Tools')
        sections.push(FILE_EDIT_DECISION_GUIDE)
        for (const config of categories.write) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.terminal.length > 0) {
        sections.push('## Terminal Tools')
        for (const config of categories.terminal) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.lsp.length > 0) {
        sections.push('## Code Intelligence Tools')
        for (const config of categories.lsp) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.network.length > 0) {
        sections.push('## Network Tools')
        for (const config of categories.network) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.interaction.length > 0) {
        sections.push('## Interaction Tools')
        for (const config of categories.interaction) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    return sections.join('\n\n')
}

// ============================================
// 导出生成的数据
// ============================================

/** 所有工具定义（发送给 LLM） */
export const TOOL_DEFINITIONS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateToolDefinition(config)])
)

/** 所有 Zod Schemas */
export const TOOL_SCHEMAS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateZodSchema(config)])
)

/** 工具显示名称映射 */
export const TOOL_DISPLAY_NAMES = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, config.displayName])
)

// ============================================
// 辅助函数
// ============================================

/** 获取工具审批类型 */
export function getToolApprovalType(toolName: string): ToolApprovalType {
    return TOOL_CONFIGS[toolName]?.approvalType || 'none'
}

/** 获取工具显示名称 */
export function getToolDisplayName(toolName: string): string {
    return TOOL_CONFIGS[toolName]?.displayName || toolName
}

/** 获取只读工具列表 */
export function getReadOnlyTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel && config.category !== 'write')
        .map(([name]) => name)
}

/** 获取写入工具列表 */
export function getWriteTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.category === 'write')
        .map(([name]) => name)
}

/** 获取需要审批的工具 */
export function getApprovalRequiredTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.approvalType !== 'none')
        .map(([name]) => name)
}

/** 检查工具是否可并行执行 */
export function isParallelTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.parallel ?? false
}

/** 获取可并行执行的工具列表 */
export function getParallelTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel)
        .map(([name]) => name)
}

/** 检查工具是否为写入类工具 */
export function isWriteTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.category === 'write'
}

/** 检查工具是否为文件编辑工具（会产生文件内容变更，不包括删除） */
export function isFileEditTool(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder', 'replace_file_content'].includes(toolName)
}

/** 检查工具是否需要保存文件快照（用于撤销功能） */
export function needsFileSnapshot(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder', 'replace_file_content', 'delete_file_or_folder'].includes(toolName)
}

/** 检查工具是否需要 Diff 预览（使用 FileChangeCard） */
export function needsDiffPreview(toolName: string): boolean {
    return ['edit_file', 'write_file', 'replace_file_content'].includes(toolName)
}

/** 获取工具元数据 */
export function getToolMetadata(toolName: string): ToolConfig | undefined {
    return TOOL_CONFIGS[toolName]
}
