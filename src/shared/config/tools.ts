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
        description: `Read file contents. MUST read before editing.

### 🎯 OPTIMAL USAGE
- **Default**: Read ENTIRE file (omit start_line/end_line)
- **If truncated**: Use search_files to locate target, then read with line range

### ⚠️ HANDLING TRUNCATION
If you see "(file content truncated...)", the file is large. Do this:
1. Use \`search_files\` to find the exact location of what you need
2. Then use \`read_file\` with \`start_line/end_line\` to read that section
3. Include ~50 lines of context around your target

### 🚫 FORBIDDEN
- ❌ Reading same file repeatedly without using search first
- ❌ Multiple read_file calls for different files → use read_multiple_files

### ✅ CORRECT (for large files)
\`\`\`
# Step 1: Find target location
search_files path="js/main.js" pattern="functionName"
# Result: js/main.js:150: function functionName()

# Step 2: Read with context
read_file path="js/main.js" start_line=130 end_line=200
\`\`\``,
        detailedDescription: `Read file contents from the filesystem with line numbers (1-indexed).
- Returns content in "line_number: content" format
- Large files (>6000 chars) will be truncated
- When truncated, use search_files first to locate target`,
        examples: [
            'read_file path="src/main.ts" → Read entire file',
            'read_file path="large.js" start_line=100 end_line=200 → Read specific section',
        ],
        criticalRules: [
            'If truncated, use search_files to find target first',
            'For 2+ files, use read_multiple_files instead',
            'Include ~50 lines context when using line ranges',
        ],
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts", NOT "./src/main.ts" or full path)', required: true },
            start_line: { type: 'number', description: 'ONLY for files >1000 lines. Starting line (1-indexed)' },
            end_line: { type: 'number', description: 'ONLY for files >1000 lines. Ending line (inclusive)' },
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
        description: `Read 2+ files in ONE call. ALWAYS use this instead of multiple read_file.

### 🎯 OPTIMAL USAGE
- Need to read 2+ files? Use THIS tool, not multiple read_file calls

### ✅ CORRECT
\`\`\`
read_multiple_files paths=["src/a.ts", "src/b.ts", "src/c.ts"]
\`\`\`

### ❌ WRONG
\`\`\`
read_file path="src/a.ts"
read_file path="src/b.ts"
read_file path="src/c.ts"  // 3 calls instead of 1!
\`\`\``,
        detailedDescription: `Read multiple files in a single call for better efficiency.
- Use when you need to read 2+ related files
- Returns all file contents with clear separators
- Parallel execution internally for speed`,
        examples: [
            'read_multiple_files paths=["src/types.ts", "src/utils.ts", "src/index.ts"]',
        ],
        criticalRules: [
            'ALWAYS use this for 2+ files instead of multiple read_file calls',
        ],
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            paths: { type: 'array', description: 'Array of file paths relative to workspace root (e.g., ["src/a.ts", "src/b.ts"])', required: true, items: { type: 'string', description: 'File path relative to workspace root' } },
        },
    },

    list_directory: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: `List files in a directory.

### 🎯 OPTIMAL USAGE
- Use ONCE per directory, don't call repeatedly
- For recursive view, use get_dir_tree instead`,
        detailedDescription: `List directory contents with file types and sizes.
- Shows files and subdirectories
- Includes file size and modification info`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for workspace root, "src" for src folder (NOT "./src")', required: true },
        },
    },

    get_dir_tree: {
        name: 'get_dir_tree',
        displayName: 'Directory Tree',
        description: `Get recursive directory tree. Use ONCE for project overview.

### 🎯 OPTIMAL USAGE
- Call ONCE at start to understand project structure
- Don't call repeatedly - results are cached mentally`,
        detailedDescription: `Get a tree view of directory structure.
- Recursive listing up to max_depth
- Useful for understanding project layout`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Root directory path relative to workspace root. Use "." for workspace root, "src" for src folder (NOT "./src")', required: true },
            max_depth: { type: 'number', description: 'Maximum depth (default: 3)', default: 3 },
        },
    },

    // ===== 搜索工具 =====
    search_files: {
        name: 'search_files',
        displayName: 'Search Files',
        description: `Search for text/patterns in files or single file.

### 🎯 OPTIMAL USAGE
- **Multiple patterns**: Combine with | in ONE call
- **Single file**: Use file path as path parameter

### ✅ CORRECT
\`\`\`
// Multiple patterns - ONE call
search_files path="src" pattern="useState|useEffect|useCallback" is_regex=true

// Single file search
search_files path="src/styles.css" pattern="button|card|modal" is_regex=true
\`\`\`

### ❌ WRONG
\`\`\`
search_files path="src" pattern="useState"
search_files path="src" pattern="useEffect"
search_files path="src" pattern="useCallback"  // 3 calls instead of 1!
\`\`\`

### When NOT to Use
- Conceptual queries ("how does auth work?") → use codebase_search`,
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
            path: { type: 'string', description: 'Directory OR file path relative to workspace root (e.g., "src" or "src/main.ts", NOT "./src")', required: true },
            pattern: { type: 'string', description: 'Pattern. Combine multiple with | (e.g., "pat1|pat2|pat3")', required: true },
            is_regex: { type: 'boolean', description: 'Enable regex (auto-enabled for | patterns)', default: false },
            file_pattern: { type: 'string', description: 'Filter files (e.g., "*.ts")' },
        },
    },

    codebase_search: {
        name: 'codebase_search',
        displayName: 'Semantic Search',
        description: `AI semantic search. Use for conceptual queries.

### 🎯 OPTIMAL USAGE
- Ask complete questions: "where is authentication handled?"
- ONE call per concept - don't repeat similar queries

### When to Use
- Conceptual: "how does payment flow work?"
- Finding related code by meaning

### When NOT to Use
- Exact text → use search_files
- Symbol lookup → use search_files`,
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
        description: `Replace old_string with new_string. MUST read_file first.

### 🎯 OPTIMAL USAGE
- Read file ONCE before editing
- Include 3-5 lines context for unique match
- Make ALL changes to a file in ONE edit when possible

### 🚫 FORBIDDEN
- ❌ Editing without reading first
- ❌ Multiple small edits to same file → combine into ONE edit

### ✅ CORRECT
\`\`\`
read_file path="src/utils.ts"
edit_file path="src/utils.ts" old_string="function calc(x) {
  return x * 2;
}" new_string="function calc(x: number): number {
  return x * 2;
}"
\`\`\`

### Error Recovery
If "old_string not found": read_file again, copy EXACT content`,
        detailedDescription: `Smart string replacement with fallback matching strategies.
- old_string must UNIQUELY identify location
- Include surrounding context for uniqueness`,
        examples: [
            'edit_file path="src/utils.ts" old_string="..." new_string="..."',
        ],
        criticalRules: [
            'MUST read_file before editing',
            'Include 3-5 lines context for unique match',
            'Combine multiple changes into ONE edit when possible',
        ],
        commonErrors: [
            { error: 'old_string not found', solution: 'Read file again, copy exact content' },
            { error: 'Multiple matches', solution: 'Include more context lines' },
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/utils.ts", NOT "./src/utils.ts")', required: true },
            old_string: { type: 'string', description: 'Text to find (include 3-5 lines context)', required: true },
            new_string: { type: 'string', description: 'Replacement text', required: true },
            replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
        },
    },

    replace_file_content: {
        name: 'replace_file_content',
        displayName: 'Replace Lines',
        description: `Replace line range. Use line numbers from read_file.

### 🎯 OPTIMAL USAGE
- Alternative to edit_file when you know exact line numbers
- MUST read_file first to get accurate line numbers`,
        detailedDescription: `Replace a range of lines with new content.
- Use line numbers from read_file output
- Both start_line and end_line are inclusive`,
        examples: [
            'replace_file_content path="src/config.ts" start_line=10 end_line=15 content="..."',
        ],
        criticalRules: [
            'MUST read_file first for accurate line numbers',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/config.ts")', required: true },
            start_line: { type: 'number', description: 'Start line (1-indexed)', required: true },
            end_line: { type: 'number', description: 'End line (inclusive)', required: true },
            content: { type: 'string', description: 'New content', required: true },
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
        description: `Create new file or OVERWRITE entire file.

### 🎯 OPTIMAL USAGE
- New files: use this
- Complete rewrite: use this
- Partial changes: use edit_file instead (preserves content)

### 🚫 WARNING
This OVERWRITES entire file. For partial edits, use edit_file.`,
        detailedDescription: `Write complete file content.
- Creates new file if doesn't exist
- OVERWRITES entire file if exists`,
        criticalRules: [
            'OVERWRITES entire file - use edit_file for partial changes',
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
            recursive: { type: 'boolean', description: 'Delete folder contents', default: false },
        },
    },

    // ===== 终端工具 =====
    run_command: {
        name: 'run_command',
        displayName: 'Run Command',
        description: `Execute shell command. Requires approval.

### 🎯 OPTIMAL USAGE
- npm/yarn commands, git, build scripts
- Use cwd parameter instead of cd

### 🚫 NEVER USE FOR
- Reading files → use read_file (NOT cat/head/tail)
- Searching → use search_files (NOT grep/find)
- Editing → use edit_file (NOT sed/awk)`,
        detailedDescription: `Execute shell commands in workspace.
- Requires user approval
- Use cwd parameter instead of cd commands`,
        examples: [
            'run_command command="npm install"',
            'run_command command="npm test" cwd="packages/core"',
        ],
        criticalRules: [
            'NEVER use cat/grep/sed - use dedicated tools',
            'Use cwd parameter instead of cd',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            command: { type: 'string', description: 'Shell command', required: true },
            cwd: { type: 'string', description: 'Working directory relative to workspace root (e.g., "packages/core", NOT "./packages/core")', },
            timeout: { type: 'number', description: 'Timeout seconds (default: 30)', default: 30 },
            is_background: { type: 'boolean', description: 'Run in background', default: false },
        },
    },

    // ===== LSP 工具 =====
    get_lint_errors: {
        name: 'get_lint_errors',
        displayName: 'Lint Errors',
        description: `Get lint/compile errors. Use ONCE after editing.

### 🎯 OPTIMAL USAGE
- Call ONCE after editing a file
- Don't call repeatedly for same file`,
        detailedDescription: `Get diagnostics (errors, warnings) for a file.
- Shows TypeScript/ESLint errors
- Use after editing to verify code`,
        criticalRules: [
            'Call once after editing, not repeatedly',
        ],
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root to check (e.g., "src/main.ts")', required: true },
        },
    },

    find_references: {
        name: 'find_references',
        displayName: 'Find References',
        description: 'Find all references to symbol at position.',
        detailedDescription: `Find all usages of a symbol across codebase.
- Requires exact file position (line, column)
- Useful for refactoring`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    go_to_definition: {
        name: 'go_to_definition',
        displayName: 'Go to Definition',
        description: 'Get definition location of symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_hover_info: {
        name: 'get_hover_info',
        displayName: 'Hover Info',
        description: 'Get type info and docs for symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_document_symbols: {
        name: 'get_document_symbols',
        displayName: 'Document Symbols',
        description: `Get all symbols in file. Call ONCE per file.

### 🎯 OPTIMAL USAGE
- Call ONCE to understand file structure
- Don't call repeatedly for same file`,
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
 * 
 * 使用 description 作为主要描述（包含反碎片化规则）
 * detailedDescription 已废弃，保留字段仅为兼容性
 */
export function generateToolPromptDescription(config: ToolConfig): string {
    const lines: string[] = []
    
    // 工具名
    lines.push(`### ${config.displayName} (\`${config.name}\`)`)
    
    // 使用 description（包含反碎片化规则）作为主要描述
    lines.push(config.description)
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
    
    // 常见错误（保留，因为对用户有帮助）
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
        plan: [],
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
