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

export type ToolCategory = 'read' | 'write' | 'terminal' | 'search' | 'lsp' | 'network' | 'plan'

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
        description: `Read file contents with line numbers. You MUST read a file before editing it.

### Output Format
Lines are numbered: "LINE_NUMBER: CONTENT"

### ⚠️ CRITICAL
- ALWAYS read a file before using edit_file on it
- If edit_file fails, read the file again before retrying
- Use line numbers from output when using replace_file_content
- The file content may have changed since your last read`,
        detailedDescription: `Read file contents from the filesystem with line numbers (1-indexed).
- Returns content in "line_number: content" format
- Default: reads entire file
- Use start_line/end_line for large files (>500 lines)

**When to Use:**
- Before editing any file (MANDATORY)
- Understanding code structure
- Getting exact content for edit_file old_string

**When NOT to Use:**
- Reading multiple files → use read_multiple_files
- Searching for patterns → use search_files`,
        examples: [
            'read_file path="src/main.ts" → Read entire file',
            'read_file path="src/main.ts" start_line=100 end_line=150 → Read specific section',
        ],
        criticalRules: [
            'ALWAYS read a file before editing it',
            'If edit_file fails, read the file again - content may have changed',
            'Use line numbers from output for replace_file_content',
        ],
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path (relative to workspace)', required: true },
            start_line: { type: 'number', description: 'Starting line number (1-indexed, optional)' },
            end_line: { type: 'number', description: 'Ending line number (inclusive, optional)' },
        },
        validate: (data) => {
            if (data.start_line && data.end_line && (data.start_line as number) > (data.end_line as number)) {
                return { valid: false, error: 'start_line must be <= end_line' }
            }
            return { valid: true }
        },
    },

    read_multiple_files: {
        name: 'read_multiple_files',
        displayName: 'Read Multiple Files',
        description: 'Read multiple files at once. More efficient than multiple read_file calls.',
        detailedDescription: `Read multiple files in a single call for better efficiency.
- Use when you need to read 2+ related files
- Returns all file contents with clear separators
- Parallel execution internally for speed`,
        examples: [
            'read_multiple_files paths=["src/types.ts", "src/utils.ts", "src/index.ts"]',
        ],
        criticalRules: [
            'Prefer this over multiple read_file calls when reading related files',
        ],
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            paths: { type: 'array', description: 'Array of file paths to read', required: true, items: { type: 'string', description: 'File path' } },
        },
    },

    list_directory: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: 'List files and folders in a directory with metadata.',
        detailedDescription: `List directory contents with file types and sizes.
- Shows files and subdirectories
- Includes file size and modification info
- Use for exploring project structure`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory path (use "." for workspace root)', required: true },
        },
    },

    get_dir_tree: {
        name: 'get_dir_tree',
        displayName: 'Directory Tree',
        description: 'Get recursive directory tree structure for project overview.',
        detailedDescription: `Get a tree view of directory structure.
- Recursive listing up to max_depth
- Useful for understanding project layout
- Respects .gitignore patterns`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Root directory path', required: true },
            max_depth: { type: 'number', description: 'Maximum depth (default: 3)', default: 3 },
        },
    },

    // ===== 搜索工具 =====
    search_files: {
        name: 'search_files',
        displayName: 'Search Files',
        description: `Fast text/regex search across files. Use for exact text or pattern matching.

### When to Use
- Finding exact text or symbols (function names, variables, imports)
- Regex pattern matching
- Finding all usages of a specific string

### When NOT to Use
- Conceptual queries ("how does auth work?") → use codebase_search
- Searching in a single known file → use search_in_file`,
        detailedDescription: `Fast content search using ripgrep-style matching.
- Searches file contents for pattern matches
- Supports regex patterns with is_regex=true
- Filter by file type with file_pattern (e.g., "*.ts")
- Returns matching lines with file path and line number

**Pattern Syntax (ripgrep):**
- Escape special chars: \\( \\) \\[ \\] \\{ \\} \\+ \\* \\? \\^ \\$ \\| \\. \\\\
- Word boundary: \\bword\\b
- Any whitespace: \\s+`,
        examples: [
            'search_files path="src" pattern="TODO" → Find all TODOs',
            'search_files path="." pattern="function\\s+handle" is_regex=true → Find function declarations',
            'search_files path="src" pattern="import" file_pattern="*.tsx" → Search only TSX files',
        ],
        criticalRules: [
            'Use this instead of bash grep/find commands',
            'For semantic/conceptual queries, use codebase_search instead',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory to search in', required: true },
            pattern: { type: 'string', description: 'Search pattern (text or regex)', required: true },
            is_regex: { type: 'boolean', description: 'Treat pattern as regex (default: false)', default: false },
            file_pattern: { type: 'string', description: 'Glob pattern to filter files (e.g., "*.ts", "*.{js,jsx}")' },
        },
    },

    search_in_file: {
        name: 'search_in_file',
        displayName: 'Search in File',
        description: 'Search for pattern within a specific file. Returns matching lines with line numbers.',
        detailedDescription: `Search within a single file for pattern matches.
- Returns all matching lines with line numbers
- Useful for finding specific code in a known file
- Supports regex patterns`,
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to search in', required: true },
            pattern: { type: 'string', description: 'Search pattern', required: true },
            is_regex: { type: 'boolean', description: 'Use regex pattern', default: false },
        },
    },

    codebase_search: {
        name: 'codebase_search',
        displayName: 'Semantic Search',
        description: `Semantic search using AI. Use for conceptual queries like "how does X work?"

### When to Use
- Conceptual questions: "where is authentication handled?"
- Understanding code flow: "how does payment processing work?"
- Finding related code by meaning

### When NOT to Use
- Exact text/symbol search → use search_files
- Single word lookups → use search_files`,
        detailedDescription: `AI-powered semantic search for finding related code by meaning.
- Understands natural language queries
- Finds conceptually related code, not just text matches
- Ask complete questions for best results

**Good queries:**
- "Where is user authentication handled?"
- "How does the payment flow work?"
- "Find error handling for API requests"

**Bad queries:**
- "AuthService" (too short, use search_files)
- "function" (too generic)`,
        examples: [
            'codebase_search query="user authentication logic"',
            'codebase_search query="where are database connections managed?"',
        ],
        criticalRules: [
            'Use complete questions for best results',
            'For exact text search, use search_files instead',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Natural language search query - ask a complete question', required: true },
            top_k: { type: 'number', description: 'Number of results (default: 10)', default: 10 },
        },
    },

    // ===== 编辑类工具 =====
    edit_file: {
        name: 'edit_file',
        displayName: 'Edit File',
        description: `Edit file by replacing old_string with new_string. MUST read file first.

### ⚠️ CRITICAL: READ BEFORE EDIT
You MUST use read_file at least once before using edit_file on ANY file.
If edit_file fails, READ THE FILE AGAIN before retrying.

### REQUIREMENTS
1. old_string must UNIQUELY identify the location (include 3-5 lines of context)
2. old_string must match EXACTLY including whitespace and indentation
3. If multiple matches exist, the edit will FAIL - include more context

### When to Use
- Modifying existing code in a file
- Adding/removing/changing specific code sections

### When NOT to Use
- Creating new files → use write_file
- Replacing by line numbers → use replace_file_content
- File doesn't exist → use write_file

### Error Recovery
If edit fails with "old_string not found":
1. Use read_file to get current file content
2. Copy the EXACT text including all whitespace
3. Include MORE surrounding context (3-5 lines before and after)
4. If still failing, use replace_file_content with line numbers instead`,
        detailedDescription: `Smart string replacement with multiple fallback matching strategies.

**Matching Strategies (tried in order):**
1. Exact match
2. Line-trimmed (ignores leading/trailing whitespace per line)
3. Block-anchor (matches by first/last line + similarity)
4. Whitespace-normalized
5. Indentation-flexible

**Example - Good:**
\`\`\`
old_string: "function calculate(x) {
  const result = x * 2;
  return result;
}"
new_string: "function calculate(x: number): number {
  const result = x * 2;
  return result;
}"
\`\`\`
Reason: Includes full function for unique identification.

**Example - Bad:**
\`\`\`
old_string: "return result;"
new_string: "return result * 2;"
\`\`\`
Reason: Too short, may match multiple locations.`,
        examples: [
            'edit_file path="src/utils.ts" old_string="function add(a, b) {\\n  return a + b;\\n}" new_string="function add(a: number, b: number): number {\\n  return a + b;\\n}"',
        ],
        criticalRules: [
            'ALWAYS use read_file BEFORE edit_file to get exact file content',
            'Include 3-5 lines of surrounding context to ensure unique match',
            'If edit fails, read the file again - content may have changed',
            'For new files, use write_file instead',
            'If stuck, try replace_file_content with line numbers as alternative',
        ],
        commonErrors: [
            { error: 'old_string not found', solution: 'Read the file again with read_file, copy exact content including whitespace. The file may have changed.' },
            { error: 'Multiple matches found', solution: 'Include more surrounding context (3-5 lines before and after) to make old_string unique' },
            { error: 'File not found', solution: 'Use write_file to create new files, not edit_file' },
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to edit', required: true },
            old_string: { type: 'string', description: 'Exact text to find (include 3-5 lines of context for uniqueness)', required: true },
            new_string: { type: 'string', description: 'New text to replace with', required: true },
            replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)', default: false },
        },
    },

    replace_file_content: {
        name: 'replace_file_content',
        displayName: 'Replace Lines',
        description: 'Replace specific line range in a file. Use line numbers from read_file.',
        detailedDescription: `Replace a range of lines with new content.
- Use line numbers from read_file output
- Replaces lines start_line through end_line (inclusive)
- Best for: replacing function bodies, updating config sections`,
        examples: [
            'replace_file_content path="src/config.ts" start_line=10 end_line=15 content="export const config = {\\n  debug: true\\n};"',
        ],
        criticalRules: [
            'ALWAYS read_file first to get accurate line numbers',
            'Line numbers are 1-indexed (first line is 1)',
            'Both start_line and end_line are inclusive',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            start_line: { type: 'number', description: 'Start line number (1-indexed)', required: true },
            end_line: { type: 'number', description: 'End line number (inclusive)', required: true },
            content: { type: 'string', description: 'New content to insert', required: true },
        },
        validate: (data) => {
            if ((data.start_line as number) > (data.end_line as number)) {
                return { valid: false, error: 'start_line must be <= end_line' }
            }
            return { valid: true }
        },
    },

    write_file: {
        name: 'write_file',
        displayName: 'Write File',
        description: 'Create new file or overwrite entire file. Use for new files or complete rewrites.',
        detailedDescription: `Write complete file content.
- Creates new file if it doesn't exist
- OVERWRITES entire file if it exists
- Use for: new files, complete file rewrites, generated code`,
        criticalRules: [
            'This OVERWRITES the entire file - use edit_file for partial changes',
            'For existing files, prefer edit_file or replace_file_content',
            'Do not create documentation files unless explicitly requested',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            content: { type: 'string', description: 'Complete file content', required: true },
        },
    },

    create_file_or_folder: {
        name: 'create_file_or_folder',
        displayName: 'Create',
        description: 'Create new file or folder. Path ending with / creates folder.',
        detailedDescription: `Create new files or directories.
- Path ending with "/" creates a folder
- Path without "/" creates a file
- Can include initial content for files`,
        examples: [
            'create_file_or_folder path="src/utils/" → Create folder',
            'create_file_or_folder path="src/config.ts" content="export default {}" → Create file with content',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path (end with / for folder)', required: true },
            content: { type: 'string', description: 'Initial content for files (optional)' },
        },
    },

    delete_file_or_folder: {
        name: 'delete_file_or_folder',
        displayName: 'Delete',
        description: 'Delete a file or folder. Requires approval for safety.',
        detailedDescription: `Delete files or directories.
- Requires user approval (dangerous operation)
- Use recursive=true for non-empty folders
- Cannot be undone`,
        criticalRules: [
            'This is a DESTRUCTIVE operation - requires user approval',
            'Double-check the path before deleting',
        ],
        category: 'write',
        approvalType: 'dangerous',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path to delete', required: true },
            recursive: { type: 'boolean', description: 'Delete folder contents recursively', default: false },
        },
    },

    // ===== 终端工具 =====
    run_command: {
        name: 'run_command',
        displayName: 'Run Command',
        description: `Execute shell command. Requires user approval.

### When to Use
- npm/yarn/pnpm commands (install, build, test)
- Git operations (status, diff, log)
- Build scripts and test runners
- System commands

### NEVER Use For
- Reading files → use read_file (NOT cat/head/tail)
- Searching files → use search_files (NOT grep/find)
- Editing files → use edit_file (NOT sed/awk)`,
        detailedDescription: `Execute shell commands in the workspace.
- Requires user approval for safety
- Use cwd parameter instead of cd commands
- For long-running commands, set is_background=true`,
        examples: [
            'run_command command="npm install"',
            'run_command command="npm run build"',
            'run_command command="git status"',
            'run_command command="npm test" cwd="packages/core"',
        ],
        criticalRules: [
            'NEVER use cat/head/tail to read files - use read_file',
            'NEVER use grep/find to search - use search_files',
            'NEVER use sed/awk to edit - use edit_file',
            'NEVER run destructive git commands without explicit request',
            'NEVER commit or push unless explicitly asked',
            'Use cwd parameter instead of cd commands',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            command: { type: 'string', description: 'Shell command to execute', required: true },
            cwd: { type: 'string', description: 'Working directory (use instead of cd)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 30)', default: 30 },
            is_background: { type: 'boolean', description: 'Run in background for long-running commands', default: false },
        },
    },

    // ===== LSP 工具 =====
    get_lint_errors: {
        name: 'get_lint_errors',
        displayName: 'Lint Errors',
        description: 'Get lint/compile errors for a file. Use after editing to verify changes.',
        detailedDescription: `Get diagnostics (errors, warnings) for a file.
- Shows TypeScript/ESLint errors
- Use after editing to verify code is valid
- Helps catch issues before running`,
        criticalRules: [
            'Run this after editing files to catch errors early',
        ],
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to check', required: true },
        },
    },

    find_references: {
        name: 'find_references',
        displayName: 'Find References',
        description: 'Find all references to a symbol at given position.',
        detailedDescription: `Find all usages of a symbol across the codebase.
- Requires exact file position (line, column)
- Returns all files/locations that reference the symbol
- Useful for refactoring and understanding code usage`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    go_to_definition: {
        name: 'go_to_definition',
        displayName: 'Go to Definition',
        description: 'Get the definition location of a symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_hover_info: {
        name: 'get_hover_info',
        displayName: 'Hover Info',
        description: 'Get type information and documentation for a symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_document_symbols: {
        name: 'get_document_symbols',
        displayName: 'Document Symbols',
        description: 'Get all symbols (functions, classes, variables) in a file.',
        detailedDescription: `List all symbols defined in a file.
- Shows functions, classes, interfaces, variables
- Useful for understanding file structure
- Returns symbol names, types, and locations`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
        },
    },

    // ===== 网络工具 =====
    web_search: {
        name: 'web_search',
        displayName: 'Web Search',
        description: 'Search the web for information.',
        category: 'network',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Search query', required: true },
            max_results: { type: 'number', description: 'Maximum results (default: 5)', default: 5 },
        },
    },

    read_url: {
        name: 'read_url',
        displayName: 'Read URL',
        description: 'Fetch and read content from a URL.',
        category: 'network',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            url: { type: 'string', description: 'URL to fetch', required: true },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 30)', default: 30 },
        },
    },

    // ===== Plan 工具 =====
    create_plan: {
        name: 'create_plan',
        displayName: 'Create Plan',
        description: 'Create execution plan for complex multi-step tasks.',
        detailedDescription: `Create a structured plan for complex tasks.
- Break down task into logical steps
- Each step should be verifiable
- Use for tasks requiring multiple tool calls`,
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            items: {
                type: 'array',
                description: 'Plan items',
                required: true,
                items: {
                    type: 'object',
                    description: 'Plan item',
                    properties: {
                        title: { type: 'string', description: 'Step title', required: true },
                        description: { type: 'string', description: 'Step description' },
                    },
                },
            },
        },
    },

    update_plan: {
        name: 'update_plan',
        displayName: 'Update Plan',
        description: 'Update plan item status. Use after completing or failing a step.',
        detailedDescription: `Update the status of plan items.
- Use items array to update specific item statuses
- Each item needs: id (or index like "1", "2") and status ("completed", "in_progress", "failed")
- Example: items=[{id:"1", status:"completed"}] to mark step 1 as done`,
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            items: { 
                type: 'array', 
                description: 'Items to update. Each item: {id: "1", status: "completed"|"in_progress"|"failed"}',
                required: true,
            },
            status: { type: 'string', description: 'Overall plan status (optional)', enum: ['active', 'completed', 'failed'] },
        },
    },

    ask_user: {
        name: 'ask_user',
        displayName: 'Ask User',
        description: 'Ask user to select from options. Use in Plan mode to gather requirements before creating task templates.',
        detailedDescription: `Present interactive options to the user and wait for their selection.
- Use to gather requirements, preferences, or confirmations
- Options are displayed as clickable cards
- Supports single or multiple selection
- The tool blocks until user makes a selection`,
        examples: [
            'ask_user question="What type of task?" options=[{id:"feature",label:"New Feature"},{id:"bugfix",label:"Bug Fix"}]',
            'ask_user question="Which files to modify?" options=[...] multiSelect=true',
        ],
        criticalRules: [
            'Use this tool in Plan mode to gather requirements before creating task templates',
            'Keep options concise and clear',
            'Provide descriptions for complex options',
        ],
        category: 'plan',
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
                    description: 'Option item',
                    properties: {
                        id: { type: 'string', description: 'Unique option ID', required: true },
                        label: { type: 'string', description: 'Display label', required: true },
                        description: { type: 'string', description: 'Optional description' },
                    },
                },
            },
            multiSelect: { type: 'boolean', description: 'Allow multiple selections (default: false)', default: false },
        },
    },

    // ===== UI/UX 设计工具 =====
    uiux_search: {
        name: 'uiux_search',
        displayName: 'UI/UX Search',
        description: 'Search UI/UX design database for styles, colors, typography, and best practices.',
        detailedDescription: `Search the design knowledge base for:
- UI styles (glassmorphism, minimalism, etc.)
- Color palettes for different industries
- Typography and font pairings
- Chart recommendations
- Landing page patterns
- UX best practices`,
        examples: [
            'uiux_search query="glassmorphism" domain="style"',
            'uiux_search query="saas dashboard" domain="color"',
            'uiux_search query="elegant font" domain="typography"',
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
                enum: ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt'],
            },
            stack: {
                type: 'string',
                description: 'Tech stack for stack-specific guidelines',
                enum: ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter'],
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
}


// ============================================
// 工具选择决策指南
// ============================================

/**
 * 文件编辑工具选择决策树
 * 根据场景选择最合适的工具
 */
export const FILE_EDIT_DECISION_GUIDE = `
## File Editing Tool Selection

**Decision Tree:**
1. Is this a NEW file that doesn't exist?
   → Use \`write_file\` or \`create_file_or_folder\`

2. Do you need to REPLACE THE ENTIRE file content?
   → Use \`write_file\`

3. Do you know the EXACT LINE NUMBERS to change?
   → Use \`replace_file_content\` (preferred for precision)

4. Do you know the EXACT TEXT to find and replace?
   → Use \`edit_file\` with old_string/new_string

**Quick Reference:**
| Scenario | Tool | Why |
|----------|------|-----|
| Create new file | write_file | Creates with full content |
| Rewrite entire file | write_file | Complete replacement |
| Change specific lines | replace_file_content | Line-based precision |
| Replace exact text | edit_file | String matching |
| Add to end of file | edit_file | Match last lines, add new |
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

3. Searching within a SINGLE KNOWN FILE?
   → Use \`search_in_file\`

4. Looking for FILES BY NAME/PATTERN?
   → Use \`list_directory\` or \`get_dir_tree\`

**NEVER use bash grep/find - use these tools instead.**
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

/** 生成 Zod Schema */
export function generateZodSchema(config: ToolConfig): z.ZodSchema {
    if (config.customSchema) {
        return config.customSchema
    }

    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, prop] of Object.entries(config.parameters)) {
        let schema: z.ZodTypeAny

        switch (prop.type) {
            case 'string':
                schema = prop.enum
                    ? z.enum(prop.enum as [string, ...string[]])
                    : z.string().min(1, `${key} is required`)
                break
            case 'number':
                schema = z.number().int()
                break
            case 'boolean':
                schema = z.boolean()
                break
            case 'array':
                schema = z.array(z.any())
                break
            case 'object':
                schema = z.object({}).passthrough()
                break
            default:
                schema = z.any()
        }

        if (!prop.required) {
            schema = schema.optional()
            if (prop.default !== undefined) {
                schema = schema.default(prop.default)
            }
        }

        shape[key] = schema
    }

    const objectSchema = z.object(shape)

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
 */
export function generateToolPromptDescription(config: ToolConfig): string {
    const lines: string[] = []
    
    // 工具名和简短描述
    lines.push(`### ${config.displayName} (\`${config.name}\`)`)
    lines.push(config.detailedDescription || config.description)
    lines.push('')
    
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
    
    // 示例
    if (config.examples && config.examples.length > 0) {
        lines.push('**Examples:**')
        for (const example of config.examples) {
            lines.push(`- \`${example}\``)
        }
        lines.push('')
    }
    
    // 关键规则
    if (config.criticalRules && config.criticalRules.length > 0) {
        lines.push('**CRITICAL:**')
        for (const rule of config.criticalRules) {
            lines.push(`- ${rule}`)
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
 * 生成所有工具的提示词描述（按类别分组）
 */
export function generateAllToolsPromptDescription(): string {
    const categories: Record<ToolCategory, ToolConfig[]> = {
        read: [],
        search: [],
        write: [],
        terminal: [],
        lsp: [],
        network: [],
        plan: [],
    }
    
    // 按类别分组
    for (const config of Object.values(TOOL_CONFIGS)) {
        if (config.enabled) {
            categories[config.category].push(config)
        }
    }
    
    const sections: string[] = []
    
    // 文件读取
    if (categories.read.length > 0) {
        sections.push('## File Reading Tools')
        for (const config of categories.read) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // 搜索
    if (categories.search.length > 0) {
        sections.push('## Search Tools')
        sections.push(SEARCH_DECISION_GUIDE)
        for (const config of categories.search) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // 文件编辑
    if (categories.write.length > 0) {
        sections.push('## File Editing Tools')
        sections.push(FILE_EDIT_DECISION_GUIDE)
        for (const config of categories.write) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // 终端
    if (categories.terminal.length > 0) {
        sections.push('## Terminal Tools')
        for (const config of categories.terminal) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // LSP
    if (categories.lsp.length > 0) {
        sections.push('## Code Intelligence Tools')
        for (const config of categories.lsp) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // 网络
    if (categories.network.length > 0) {
        sections.push('## Network Tools')
        for (const config of categories.network) {
            sections.push(generateToolPromptDescription(config))
        }
    }
    
    // 计划
    if (categories.plan.length > 0) {
        sections.push('## Planning Tools')
        for (const config of categories.plan) {
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

/** 获取工具元数据 */
export function getToolMetadata(toolName: string): ToolConfig | undefined {
    return TOOL_CONFIGS[toolName]
}
