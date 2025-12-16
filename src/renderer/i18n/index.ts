export type Language = 'en' | 'zh'

export const translations = {
	en: {
		// Title bar
		'app.name': 'Adnify',
		'settings': 'Settings',

		// Sidebar
		'explorer': 'Explorer',
		'openFolder': 'Open Folder',
		'refresh': 'Refresh',
		'noFolderOpened': 'No folder opened',

		// Editor
		'welcome': 'Welcome to Adnify',
		'welcomeDesc': 'Open a file from the sidebar or use the AI assistant',

		// Chat
		'aiAssistant': 'AI Assistant',
		'chat': 'Chat',
		'agent': 'Agent',
		'clearChat': 'Clear chat',
		'chatMode': 'Chat Mode',
		'agentMode': 'Agent Mode',
		'chatModeDesc': 'Ask me anything about your code',
		'agentModeDesc': 'I can read, edit files, and run commands for you',
		'askAnything': 'Ask me anything...',
		'configureApiKey': 'Configure API key first...',
		'apiKeyWarning': 'Please configure your API key in Settings to start chatting',
		'chatModeHint': '💬 Chat mode: Conversation only',
		'agentModeHint': '⚡ Agent mode: Can execute tools',

		// Settings
		'provider': 'Provider',
		'model': 'Model',
		'apiKey': 'API Key',
		'baseUrl': 'Base URL (Optional)',
		'baseUrlHint': 'Use custom endpoint for OpenAI-compatible APIs (e.g., Azure, local models)',
		'enterApiKey': 'Enter your {provider} API key',
		'cancel': 'Cancel',
		'saveSettings': 'Save Settings',
		'saved': 'Saved!',
		'language': 'Language',

		// Terminal
		'terminal': 'Terminal',
		'newTerminal': 'New Terminal',
		'clearTerminal': 'Clear',
		'closeTerminal': 'Close',

		// Tools
		'toolResult': 'Tool result for',

		// Diff viewer
		'acceptChanges': 'Accept Changes',
		'rejectChanges': 'Reject Changes',
		'splitView': 'Split View',
		'unifiedView': 'Unified View',
		'linesAdded': 'lines added',
		'linesRemoved': 'lines removed',

		// Code preview
		'copyCode': 'Copy code',
		'applyCode': 'Apply',
		'runCode': 'Run',

		// Auth (prepared for future)
		'login': 'Login',
		'logout': 'Logout',
		'register': 'Register',
		'email': 'Email',
		'password': 'Password',
		'forgotPassword': 'Forgot password?',
		'noAccount': "Don't have an account?",
		'hasAccount': 'Already have an account?',
		'profile': 'Profile',

		// Status
		'loading': 'Loading...',
		'error': 'Error',
		'success': 'Success',
		'saving': 'Saving...',

		// Search
		'search': 'Search',
		'replace': 'Replace',
		'matchCase': 'Match Case',
		'matchWholeWord': 'Match Whole Word',
		'useRegex': 'Use Regular Expression',
		'filesToInclude': 'Files to include',
		'filesToExclude': 'Files to exclude',
		'noResults': 'No results found',
		'textResults': 'Text Results',
		'askAiSearch': 'Ask AI to find',
		'searchPlaceholder': 'Search',
		'replacePlaceholder': 'Replace',
		'excludePlaceholder': 'e.g. *.test.ts, node_modules',

		// File Management
		'newFile': 'New File',
		'newFolder': 'New Folder',
		'rename': 'Rename',
		'delete': 'Delete',
		'confirmDelete': 'Are you sure you want to delete {name}?',
		'create': 'Create',
		'searchFile': 'Search files (Ctrl+P)',
		'gitControl': 'Git Control',

		// Tool Calls
		'needConfirmation': 'Needs your confirmation',
		'reject': 'Reject',
		'allowExecute': 'Allow',
		'readFile': 'Read File',
		'writeFile': 'Write File',
		'createFile': 'Create File',
		'editFile': 'Edit File',
		'deleteFile': 'Delete File',
		'listDirectory': 'List Directory',
		'createDirectory': 'Create Directory',
		'searchFiles': 'Search Files',
		'runCommand': 'Run Command',
		'executeCommand': 'Execute Command',
		'codePreview': 'Code Preview',
		'writing': 'Writing...',
		'receivingData': 'Receiving data...',
		'rawArguments': 'Raw Arguments',
		'proposedChanges': 'Proposed Changes',

		// Composer
		'composer': 'Composer',
		'multiFileEdit': 'Multi-file Edit',
		'filesToEdit': 'Files to edit',
		'addFile': 'Add File',
		'noFilesSelected': 'No files selected',
		'noOpenFiles': 'No open files',
		'describeChanges': 'Describe the changes you want to make...',
		'filesSelected': '{count} file(s) selected',
		'ctrlEnterGenerate': 'Ctrl+Enter to generate',
		'generating': 'Generating...',
		'generateEdits': 'Generate Edits',
		'filesModified': '{count} file(s) modified',
		'applyAll': 'Apply All',
		'apply': 'Apply',
		'applied': 'Applied',
		'rejected': 'Rejected',

		// Context Menu
		'codebaseSearch': 'Semantic search codebase',
		'currentFileSymbols': 'Functions and classes in current file',
		'gitChanges': 'Git changes and history',
		'terminalOutput': 'Terminal output',
		'selectFileToReference': 'Select a file to reference',
		'searching': 'Searching',
		'noResultsFound': 'No results found',
		'noFilesInWorkspace': 'No files in workspace',
		'navigate': 'navigate',
		'selectItem': 'select',
		'closeMenu': 'close',

		// Chat Panel
		'history': 'History',
		'setupRequired': 'Setup Required',
		'setupRequiredDesc': 'Please configure your LLM provider settings (API Key) to start using the assistant.',
		'howCanIHelp': 'How can I help you build today?',
		'pasteImagesHint': 'Paste images, Type @ to context',
		'uploadImage': 'Upload image',
		'returnToSend': 'RETURN to send',
		'editMessage': 'Edit message',
		'regenerateResponse': 'Regenerate response',
		'saveAndResend': 'Save & Resend',

		// Sessions
		'sessions': 'Sessions',
		'noSessions': 'No saved sessions',
		'deleteSession': 'Delete session',
		'loadSession': 'Load session',
		'newSession': 'New',
		'saveSession': 'Save',
		'exportSession': 'Export',
		'emptySession': 'Empty session',
		'messagesCount': '{count} messages',
		'confirmDeleteSession': 'Delete this session?',
		'justNow': 'Just now',
		'minutesAgo': '{count}m ago',
		'hoursAgo': '{count}h ago',
		'daysAgo': '{count}d ago',

		// DiffViewer
		'original': 'Original',
		'modified': 'Modified',
		'streaming': 'Streaming...',
		'virtualized': 'Virtualized',
		'fullRender': 'Full render',
		'lines': 'lines',
		'copyModified': 'Copy modified content',

		// InlineEdit
		'inlineAiEdit': 'Inline AI Edit',
		'describeChangesInline': 'Describe changes (e.g. "Fix typo", "Add error handling")...',
		'diffPreview': 'Diff Preview',
		'retry': 'Retry',
		'generate': 'Generate',
		'pressEnterApply': 'Press ↵ to apply, Esc to cancel',
		'pressEnterGenerate': 'Press ↵ to generate',
		'requestTimeout': 'Request timeout',

		// Editor
		'commandPalette': 'Command Palette',

		// StatusBar
		'codebaseIndex': 'Codebase Index',
		'indexing': 'Indexing',
		'chunks': 'chunks',
		'notIndexed': 'Not indexed',
		'aiProcessing': 'AI Processing...',

		// CommandPalette
		'typeCommandOrSearch': 'Type a command or search...',
		'noCommandsFound': 'No commands found',
	},
	zh: {
		// Title bar
		'app.name': 'Adnify',
		'settings': '设置',

		// Sidebar
		'explorer': '资源管理器',
		'openFolder': '打开文件夹',
		'refresh': '刷新',
		'noFolderOpened': '未打开文件夹',

		// Editor
		'welcome': '欢迎使用 Adnify',
		'welcomeDesc': '从侧边栏打开文件或使用 AI 助手',

		// Chat
		'aiAssistant': 'AI 助手',
		'chat': '对话',
		'agent': '代理',
		'clearChat': '清空对话',
		'chatMode': '对话模式',
		'agentMode': '代理模式',
		'chatModeDesc': '问我任何关于代码的问题',
		'agentModeDesc': '我可以帮你读取、编辑文件和执行命令',
		'askAnything': '问我任何问题...',
		'configureApiKey': '请先配置 API 密钥...',
		'apiKeyWarning': '请在设置中配置 API 密钥以开始对话',
		'chatModeHint': '💬 对话模式：仅对话',
		'agentModeHint': '⚡ 代理模式：可执行工具',

		// Settings
		'provider': '服务商',
		'model': '模型',
		'apiKey': 'API 密钥',
		'baseUrl': '自定义地址（可选）',
		'baseUrlHint': '用于 OpenAI 兼容的 API（如 Azure、本地模型）',
		'enterApiKey': '输入你的 {provider} API 密钥',
		'cancel': '取消',
		'saveSettings': '保存设置',
		'saved': '已保存！',
		'language': '语言',

		// Terminal
		'terminal': '终端',
		'newTerminal': '新建终端',
		'clearTerminal': '清空',
		'closeTerminal': '关闭',

		// Tools
		'toolResult': '工具结果：',

		// Diff viewer
		'acceptChanges': '接受更改',
		'rejectChanges': '拒绝更改',
		'splitView': '分栏视图',
		'unifiedView': '统一视图',
		'linesAdded': '行添加',
		'linesRemoved': '行删除',

		// Code preview
		'copyCode': '复制代码',
		'applyCode': '应用',
		'runCode': '运行',

		// Auth (prepared for future)
		'login': '登录',
		'logout': '退出登录',
		'register': '注册',
		'email': '邮箱',
		'password': '密码',
		'forgotPassword': '忘记密码？',
		'noAccount': '还没有账号？',
		'hasAccount': '已有账号？',
		'profile': '个人资料',

		// Status
		'loading': '加载中...',
		'error': '错误',
		'success': '成功',
		'saving': '保存中...',

		// Search
		'search': '搜索',
		'replace': '替换',
		'matchCase': '区分大小写',
		'matchWholeWord': '全字匹配',
		'useRegex': '使用正则表达式',
		'filesToInclude': '包含的文件',
		'filesToExclude': '排除的文件',
		'noResults': '未找到结果',
		'textResults': '文本搜索结果',
		'askAiSearch': '让 AI 查找',
		'searchPlaceholder': '搜索',
		'replacePlaceholder': '替换',
		'excludePlaceholder': '例如 *.test.ts, node_modules',

		// File Management
		'newFile': '新建文件',
		'newFolder': '新建文件夹',
		'rename': '重命名',
		'delete': '删除',
		'confirmDelete': '确定要删除 {name} 吗？',
		'create': '创建',
		'searchFile': '搜索文件 (Ctrl+P)',
		'gitControl': 'Git 控制',

		// Tool Calls
		'needConfirmation': '需要您的确认',
		'reject': '拒绝',
		'allowExecute': '允许',
		'readFile': '读取文件',
		'writeFile': '写入文件',
		'createFile': '创建文件',
		'editFile': '编辑文件',
		'deleteFile': '删除文件',
		'listDirectory': '列出目录',
		'createDirectory': '创建目录',
		'searchFiles': '搜索文件',
		'runCommand': '运行命令',
		'executeCommand': '执行命令',
		'codePreview': '代码预览',
		'writing': '写入中...',
		'receivingData': '接收数据中...',
		'rawArguments': '原始参数',
		'proposedChanges': '建议的更改',

		// Composer
		'composer': '编排器',
		'multiFileEdit': '多文件编辑',
		'filesToEdit': '要编辑的文件',
		'addFile': '添加文件',
		'noFilesSelected': '未选择文件',
		'noOpenFiles': '没有打开的文件',
		'describeChanges': '描述你想要的更改...',
		'filesSelected': '已选择 {count} 个文件',
		'ctrlEnterGenerate': 'Ctrl+Enter 生成',
		'generating': '生成中...',
		'generateEdits': '生成编辑',
		'filesModified': '已修改 {count} 个文件',
		'applyAll': '全部应用',
		'apply': '应用',
		'applied': '已应用',
		'rejected': '已拒绝',

		// Context Menu
		'codebaseSearch': '语义搜索代码库',
		'currentFileSymbols': '当前文件的函数和类',
		'gitChanges': 'Git 变更和历史',
		'terminalOutput': '终端输出',
		'selectFileToReference': '选择要引用的文件',
		'searching': '搜索中',
		'noResultsFound': '未找到结果',
		'noFilesInWorkspace': '工作区中没有文件',
		'navigate': '导航',
		'selectItem': '选择',
		'closeMenu': '关闭',

		// Chat Panel
		'history': '历史记录',
		'setupRequired': '需要设置',
		'setupRequiredDesc': '请在设置中配置 LLM 服务商（API 密钥）以开始使用助手。',
		'howCanIHelp': '今天我能帮你构建什么？',
		'pasteImagesHint': '粘贴图片，输入 @ 添加上下文',
		'uploadImage': '上传图片',
		'returnToSend': '回车发送',
		'editMessage': '编辑消息',
		'regenerateResponse': '重新生成',
		'saveAndResend': '保存并重发',

		// Sessions
		'sessions': '会话',
		'noSessions': '暂无保存的会话',
		'deleteSession': '删除会话',
		'loadSession': '加载会话',
		'newSession': '新建',
		'saveSession': '保存',
		'exportSession': '导出',
		'emptySession': '空会话',
		'messagesCount': '{count} 条消息',
		'confirmDeleteSession': '确定要删除这个会话吗？',
		'justNow': '刚刚',
		'minutesAgo': '{count}分钟前',
		'hoursAgo': '{count}小时前',
		'daysAgo': '{count}天前',

		// DiffViewer
		'original': '原始',
		'modified': '修改后',
		'streaming': '流式传输中...',
		'virtualized': '虚拟化',
		'fullRender': '完整渲染',
		'lines': '行',
		'copyModified': '复制修改后的内容',

		// InlineEdit
		'inlineAiEdit': '内联 AI 编辑',
		'describeChangesInline': '描述更改（例如"修复拼写错误"、"添加错误处理"）...',
		'diffPreview': '差异预览',
		'retry': '重试',
		'generate': '生成',
		'pressEnterApply': '按 ↵ 应用，Esc 取消',
		'pressEnterGenerate': '按 ↵ 生成',
		'requestTimeout': '请求超时',

		// Editor
		'commandPalette': '命令面板',

		// StatusBar
		'codebaseIndex': '代码库索引',
		'indexing': '索引中',
		'chunks': '块',
		'notIndexed': '未索引',
		'aiProcessing': 'AI 处理中...',

		// CommandPalette
		'typeCommandOrSearch': '输入命令或搜索...',
		'noCommandsFound': '未找到命令',
	}
} as const

export type TranslationKey = keyof typeof translations.en

export function t(key: TranslationKey, lang: Language, params?: Record<string, string>): string {
	let text: string = translations[lang][key] || translations.en[key] || key
	if (params) {
		Object.entries(params).forEach(([k, v]) => {
			text = text.replace(`{${k}}`, v)
		})
	}
	return text
}
