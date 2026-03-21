/**
 * MCP 服务器预设配置
 * 内置常用的 MCP 服务器，用户可以一键添加
 */

import {
  type McpPlatform,
  type McpDependencyType,
  type McpPreset,
  type McpPresetCategory,
} from '@shared/types/mcp'
import { platform as runtimePlatform } from '@shared/utils/pathUtils'

/** 分类显示名称 */
export const MCP_CATEGORY_NAMES: Record<McpPresetCategory, { en: string; zh: string }> = {
  search: { en: 'Search', zh: '搜索' },
  database: { en: 'Database', zh: '数据库' },
  filesystem: { en: 'File System', zh: '文件系统' },
  development: { en: 'Development', zh: '开发工具' },
  design: { en: 'Design', zh: '设计工具' },
  productivity: { en: 'Productivity', zh: '生产力' },
  ai: { en: 'AI Services', zh: 'AI 服务' },
  cloud: { en: 'Cloud', zh: '云服务' },
  other: { en: 'Other', zh: '其他' },
}

/** 内置 MCP 服务器预设 */
export const MCP_PRESETS: McpPreset[] = [
  // ===== 搜索类 =====
  {
    type: 'local',
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search using Brave Search API',
    descriptionZh: '使用 Brave Search API 进行网络搜索',
    category: 'search',
    icon: 'Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envConfig: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API Key',
        labelZh: 'Brave API 密钥',
        description: 'Get your API key from https://brave.com/search/api/',
        descriptionZh: '从 https://brave.com/search/api/ 获取 API 密钥',
        required: true,
        secret: true,
        placeholder: 'BSA...',
      },
    ],
    defaultAutoApprove: ['brave_web_search', 'brave_local_search'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    official: true,
    tags: ['search', 'web'],
    usageExamples: ['Search for the latest React 19 features', 'Find tutorials about TypeScript generics'],
    usageExamplesZh: ['搜索 React 19 的最新特性', '查找 TypeScript 泛型教程'],
  },
  {
    type: 'local',
    id: 'tavily-search',
    name: 'Tavily Search',
    description: 'AI-powered search engine optimized for LLMs with real-time data',
    descriptionZh: '为 LLM 优化的 AI 搜索引擎，支持实时数据',
    category: 'search',
    icon: 'Sparkles',
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    envConfig: [
      {
        key: 'TAVILY_API_KEY',
        label: 'Tavily API Key',
        labelZh: 'Tavily API 密钥',
        description: 'Get your API key from https://tavily.com/',
        descriptionZh: '从 https://tavily.com/ 获取 API 密钥',
        required: true,
        secret: true,
        placeholder: 'tvly-...',
      },
    ],
    defaultAutoApprove: ['tavily_search'],
    requiresConfig: true,
    docsUrl: 'https://github.com/tavily-ai/tavily-mcp',
    tags: ['search', 'ai', 'realtime'],
    usageExamples: ['Search for today\'s tech news', 'Find the latest AI research papers'],
    usageExamplesZh: ['搜索今天的科技新闻', '查找最新的 AI 研究论文'],
  },
  {
    type: 'local',
    id: 'exa-search',
    name: 'Exa Search',
    description: 'Neural search engine with semantic understanding',
    descriptionZh: '具有语义理解能力的神经搜索引擎',
    category: 'search',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    envConfig: [
      {
        key: 'EXA_API_KEY',
        label: 'Exa API Key',
        labelZh: 'Exa API 密钥',
        description: 'Get your API key from https://exa.ai/',
        descriptionZh: '从 https://exa.ai/ 获取 API 密钥',
        required: true,
        secret: true,
        placeholder: 'exa-...',
      },
    ],
    defaultAutoApprove: ['search', 'find_similar', 'get_contents'],
    requiresConfig: true,
    docsUrl: 'https://github.com/exa-labs/exa-mcp-server',
    tags: ['search', 'semantic', 'ai'],
    usageExamples: ['Find articles similar to this URL: ...', 'Search for companies building AI agents'],
    usageExamplesZh: ['查找与这个链接类似的文章：...', '搜索正在构建 AI Agent 的公司'],
  },

  // ===== 数据库类 =====
  {
    type: 'local',
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage SQLite databases',
    descriptionZh: '查询和管理 SQLite 数据库',
    category: 'database',
    icon: 'Database',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '${DB_PATH}'],
    envConfig: [
      {
        key: 'DB_PATH',
        label: 'Database Path',
        labelZh: '数据库路径',
        description: 'Path to SQLite database file',
        descriptionZh: 'SQLite 数据库文件路径',
        required: true,
        secret: false,
        placeholder: '/path/to/database.db',
      },
    ],
    defaultAutoApprove: ['read_query', 'list_tables', 'describe_table'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    official: true,
    tags: ['database', 'sql'],
    usageExamples: ['Show all tables in the database', 'Query users where age > 18', 'Describe the orders table structure'],
    usageExamplesZh: ['显示数据库中的所有表', '查询年龄大于 18 的用户', '描述 orders 表的结构'],
    dependencies: [
      { type: 'uv', checkCommand: 'uvx --version', installNote: 'Install uv: https://docs.astral.sh/uv/', installNoteZh: '安装 uv: https://docs.astral.sh/uv/' },
    ],
  },
  {
    type: 'local',
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Connect to PostgreSQL databases with full SQL support',
    descriptionZh: '连接 PostgreSQL 数据库，支持完整 SQL',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envConfig: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'Connection String',
        labelZh: '连接字符串',
        description: 'PostgreSQL connection string',
        descriptionZh: 'PostgreSQL 连接字符串',
        required: true,
        secret: true,
        placeholder: 'postgresql://user:password@localhost:5432/dbname',
      },
    ],
    defaultAutoApprove: ['query'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    official: true,
    tags: ['database', 'sql'],
    usageExamples: ['List all tables', 'SELECT * FROM users LIMIT 10', 'Show table schema for products'],
    usageExamplesZh: ['列出所有表', '查询前 10 个用户', '显示 products 表的结构'],
  },
  {
    type: 'local',
    id: 'mysql',
    name: 'MySQL',
    description: 'Connect to MySQL/MariaDB databases',
    descriptionZh: '连接 MySQL/MariaDB 数据库',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@benborber/mcp-server-mysql'],
    envConfig: [
      { key: 'MYSQL_HOST', label: 'Host', labelZh: '主机', required: true, secret: false, placeholder: 'localhost' },
      { key: 'MYSQL_PORT', label: 'Port', labelZh: '端口', required: false, secret: false, defaultValue: '3306' },
      { key: 'MYSQL_USER', label: 'Username', labelZh: '用户名', required: true, secret: false },
      { key: 'MYSQL_PASSWORD', label: 'Password', labelZh: '密码', required: true, secret: true },
      { key: 'MYSQL_DATABASE', label: 'Database', labelZh: '数据库名', required: true, secret: false },
    ],
    defaultAutoApprove: ['query', 'list_tables', 'describe_table'],
    requiresConfig: true,
    docsUrl: 'https://github.com/benborla/mcp-server-mysql',
    tags: ['database', 'sql', 'mysql'],
    usageExamples: ['Show all tables', 'Query orders from last week', 'Describe the customers table'],
    usageExamplesZh: ['显示所有表', '查询上周的订单', '描述 customers 表'],
  },
  {
    type: 'local',
    id: 'mongodb',
    name: 'MongoDB',
    description: 'Query and manage MongoDB databases',
    descriptionZh: '查询和管理 MongoDB 数据库',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', 'mcp-mongo-server'],
    envConfig: [
      {
        key: 'MONGODB_URI',
        label: 'MongoDB URI',
        labelZh: 'MongoDB 连接地址',
        required: true,
        secret: true,
        placeholder: 'mongodb://localhost:27017/mydb',
      },
    ],
    defaultAutoApprove: ['find', 'listCollections', 'aggregate'],
    requiresConfig: true,
    docsUrl: 'https://github.com/kiliczsh/mcp-mongo-server',
    tags: ['database', 'nosql', 'mongodb'],
    usageExamples: ['List all collections', 'Find users with status active', 'Aggregate orders by month'],
    usageExamplesZh: ['列出所有集合', '查找状态为 active 的用户', '按月聚合订单'],
  },

  // ===== 开发工具类 =====
  {
    type: 'local',
    id: 'github',
    name: 'GitHub',
    description: 'Full GitHub integration: repos, issues, PRs, actions, and more',
    descriptionZh: '完整 GitHub 集成：仓库、Issues、PR、Actions 等',
    category: 'development',
    icon: 'Github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envConfig: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Token',
        labelZh: 'GitHub 令牌',
        description: 'Personal access token with repo permissions',
        descriptionZh: '具有 repo 权限的个人访问令牌',
        required: true,
        secret: true,
        placeholder: 'ghp_...',
      },
    ],
    defaultAutoApprove: ['search_repositories', 'get_file_contents', 'list_commits', 'search_code'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    official: true,
    tags: ['git', 'code', 'ci/cd'],
    usageExamples: ['Search for React component libraries on GitHub', 'Get the README from facebook/react', 'List recent commits in my repo'],
    usageExamplesZh: ['在 GitHub 上搜索 React 组件库', '获取 facebook/react 的 README', '列出我仓库的最近提交'],
  },
  {
    type: 'local',
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab integration with CI/CD pipeline support',
    descriptionZh: 'GitLab 集成，支持 CI/CD 流水线',
    category: 'development',
    icon: 'GitBranch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envConfig: [
      { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'GitLab Token', labelZh: 'GitLab 令牌', required: true, secret: true, placeholder: 'glpat-...' },
      { key: 'GITLAB_API_URL', label: 'GitLab API URL', labelZh: 'GitLab API 地址', required: false, secret: false, defaultValue: 'https://gitlab.com/api/v4' },
    ],
    defaultAutoApprove: ['search_repositories', 'get_file_contents'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    official: true,
    tags: ['git', 'code', 'ci/cd'],
    usageExamples: ['Search for projects in my GitLab', 'Get pipeline status for my project'],
    usageExamplesZh: ['在我的 GitLab 中搜索项目', '获取我项目的流水线状态'],
  },
  {
    type: 'local',
    id: 'linear',
    name: 'Linear',
    description: 'Project management with Linear: issues, projects, and teams',
    descriptionZh: 'Linear 项目管理：问题、项目和团队',
    category: 'development',
    icon: 'ListOrdered',
    command: 'npx',
    args: ['-y', 'mcp-linear'],
    envConfig: [
      { key: 'LINEAR_API_KEY', label: 'Linear API Key', labelZh: 'Linear API 密钥', required: true, secret: true, placeholder: 'lin_api_...' },
    ],
    defaultAutoApprove: ['list_issues', 'search_issues', 'get_issue'],
    requiresConfig: true,
    docsUrl: 'https://github.com/jerhadf/linear-mcp-server',
    tags: ['project', 'issues', 'agile'],
    usageExamples: ['Show my assigned issues', 'Create a new bug issue', 'Search for issues about authentication'],
    usageExamplesZh: ['显示分配给我的问题', '创建一个新的 bug 问题', '搜索关于认证的问题'],
  },
  {
    type: 'local',
    id: 'sentry',
    name: 'Sentry',
    description: 'Error tracking and performance monitoring with Sentry',
    descriptionZh: 'Sentry 错误追踪和性能监控',
    category: 'development',
    icon: 'AlertCircle',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server'],
    envConfig: [
      { key: 'SENTRY_AUTH_TOKEN', label: 'Sentry Auth Token', labelZh: 'Sentry 认证令牌', required: true, secret: true },
      { key: 'SENTRY_ORG', label: 'Organization Slug', labelZh: '组织标识', required: true, secret: false },
    ],
    defaultAutoApprove: ['list_issues', 'get_issue', 'search_issues'],
    requiresConfig: true,
    docsUrl: 'https://github.com/getsentry/sentry-mcp',
    tags: ['monitoring', 'errors', 'debugging'],
    usageExamples: ['Show recent errors in production', 'Get details of issue PROJ-123', 'Search for TypeError exceptions'],
    usageExamplesZh: ['显示生产环境的最近错误', '获取问题 PROJ-123 的详情', '搜索 TypeError 异常'],
  },

  // ===== 云服务类 =====
  {
    type: 'local',
    id: 'aws-docs',
    name: 'AWS Documentation',
    description: 'Search and read AWS documentation',
    descriptionZh: '搜索和阅读 AWS 文档',
    category: 'cloud',
    icon: 'Cloud',
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
    envConfig: [{ key: 'FASTMCP_LOG_LEVEL', label: 'Log Level', labelZh: '日志级别', required: false, secret: false, defaultValue: 'ERROR' }],
    defaultAutoApprove: ['search_documentation', 'read_documentation'],
    requiresConfig: false,
    docsUrl: 'https://github.com/awslabs/mcp',
    tags: ['aws', 'docs', 'cloud'],
    usageExamples: ['How to create an S3 bucket?', 'Explain AWS Lambda cold start', 'Search for DynamoDB best practices'],
    usageExamplesZh: ['如何创建 S3 存储桶？', '解释 AWS Lambda 冷启动', '搜索 DynamoDB 最佳实践'],
  },
  {
    type: 'local',
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Manage Cloudflare Workers, KV, R2, and D1',
    descriptionZh: '管理 Cloudflare Workers、KV、R2 和 D1',
    category: 'cloud',
    icon: 'Cloud',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    envConfig: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare API Token', labelZh: 'Cloudflare API 令牌', required: true, secret: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', labelZh: '账户 ID', required: true, secret: false },
    ],
    defaultAutoApprove: ['list_workers', 'get_worker', 'kv_list'],
    requiresConfig: true,
    docsUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
    official: true,
    tags: ['cloudflare', 'serverless', 'edge'],
    usageExamples: ['List all my Workers', 'Get the code of my-worker', 'List KV namespaces'],
    usageExamplesZh: ['列出我所有的 Workers', '获取 my-worker 的代码', '列出 KV 命名空间'],
  },
  {
    type: 'local',
    id: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments and projects',
    descriptionZh: '管理 Vercel 部署和项目',
    category: 'cloud',
    icon: 'Cloud',
    command: 'npx',
    args: ['-y', 'mcp-server-vercel'],
    envConfig: [{ key: 'VERCEL_API_TOKEN', label: 'Vercel API Token', labelZh: 'Vercel API 令牌', required: true, secret: true }],
    defaultAutoApprove: ['list_projects', 'list_deployments', 'get_deployment'],
    requiresConfig: true,
    docsUrl: 'https://github.com/Vercel-MCP/mcp-server-vercel',
    tags: ['vercel', 'deployment', 'hosting'],
    usageExamples: ['List my Vercel projects', 'Show recent deployments', 'Get deployment logs for my-app'],
    usageExamplesZh: ['列出我的 Vercel 项目', '显示最近的部署', '获取 my-app 的部署日志'],
  },

  // ===== AI 服务类 =====
  {
    type: 'local',
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch web content and convert to markdown for LLM consumption',
    descriptionZh: '获取网页内容并转换为 Markdown，便于 LLM 处理',
    category: 'ai',
    icon: 'Globe',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    envConfig: [],
    defaultAutoApprove: ['fetch'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    official: true,
    tags: ['web', 'scraping', 'markdown'],
    usageExamples: ['Fetch the content of https://example.com', 'Read this article and summarize it: [URL]'],
    usageExamplesZh: ['获取 https://example.com 的内容', '阅读这篇文章并总结：[URL]'],
    dependencies: [
      { type: 'uv', checkCommand: 'uvx --version', installNote: 'Install uv: https://docs.astral.sh/uv/', installNoteZh: '安装 uv: https://docs.astral.sh/uv/' },
    ],
  },
  {
    type: 'local',
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation: screenshots, scraping, and interaction',
    descriptionZh: '浏览器自动化：截图、抓取和交互',
    category: 'ai',
    icon: 'Monitor',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    envConfig: [{ key: 'PUPPETEER_EXECUTABLE_PATH', label: 'Chrome Path (Optional)', labelZh: 'Chrome 路径（可选）', required: false, secret: false }],
    defaultAutoApprove: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_evaluate'],
    requiresConfig: false,
    setupCommand: 'npx puppeteer browsers install chrome',
    setupNote: 'Requires Chrome browser. Run setup command to download Chromium.',
    setupNoteZh: '需要 Chrome 浏览器。运行安装命令下载 Chromium。',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    official: true,
    tags: ['browser', 'automation', 'screenshot'],
    usageExamples: ['Take a screenshot of https://example.com', 'Click the login button on the page', 'Fill in the search form and submit'],
    usageExamplesZh: ['截取 https://example.com 的屏幕截图', '点击页面上的登录按钮', '填写搜索表单并提交'],
  },
  {
    type: 'local',
    id: 'playwright',
    name: 'Playwright',
    description: 'Cross-browser automation with Playwright',
    descriptionZh: '使用 Playwright 进行跨浏览器自动化',
    category: 'ai',
    icon: 'Monitor',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    envConfig: [],
    defaultAutoApprove: ['browser_navigate', 'browser_screenshot', 'browser_click'],
    requiresConfig: false,
    setupCommand: 'npx playwright install',
    setupNote: 'Run setup command to install browser binaries.',
    setupNoteZh: '运行安装命令安装浏览器二进制文件。',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    official: true,
    tags: ['browser', 'automation', 'testing'],
    usageExamples: ['Open https://example.com and take a screenshot', 'Test the login flow on my website', 'Scrape product prices from this page'],
    usageExamplesZh: ['打开 https://example.com 并截图', '测试我网站的登录流程', '从这个页面抓取产品价格'],
  },

  // ===== 生产力类 =====
  {
    type: 'local',
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory using knowledge graph for context retention',
    descriptionZh: '使用知识图谱的持久化记忆，保持上下文',
    category: 'productivity',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envConfig: [],
    defaultAutoApprove: ['create_entities', 'create_relations', 'read_graph', 'search_nodes'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    official: true,
    tags: ['memory', 'knowledge', 'context'],
    usageExamples: ['Remember that my project uses React 18', 'What do you know about my preferences?', 'Store this API endpoint for later'],
    usageExamplesZh: ['记住我的项目使用 React 18', '你知道我的哪些偏好？', '保存这个 API 端点以便后用'],
  },
  {
    type: 'local',
    id: 'notion',
    name: 'Notion',
    description: 'Read and search Notion pages and databases',
    descriptionZh: '读取和搜索 Notion 页面和数据库',
    category: 'productivity',
    icon: 'FileText',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envConfig: [
      { key: 'NOTION_API_KEY', label: 'Notion API Key', labelZh: 'Notion API 密钥', description: 'Create an integration at https://www.notion.so/my-integrations', descriptionZh: '在 https://www.notion.so/my-integrations 创建集成', required: true, secret: true, placeholder: 'secret_...' },
    ],
    defaultAutoApprove: ['search', 'get_page', 'get_database'],
    requiresConfig: true,
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
    official: true,
    tags: ['notion', 'docs', 'wiki'],
    usageExamples: ['Search for meeting notes in Notion', 'Get my project roadmap page', 'List items in my tasks database'],
    usageExamplesZh: ['在 Notion 中搜索会议记录', '获取我的项目路线图页面', '列出任务数据库中的项目'],
  },
  {
    type: 'local',
    id: 'slack',
    name: 'Slack',
    description: 'Read and send Slack messages, manage channels',
    descriptionZh: '读取和发送 Slack 消息，管理频道',
    category: 'productivity',
    icon: 'MessageSquare',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envConfig: [
      { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token', labelZh: 'Slack Bot 令牌', description: 'Bot token starting with xoxb-', descriptionZh: '以 xoxb- 开头的 Bot 令牌', required: true, secret: true, placeholder: 'xoxb-...' },
      { key: 'SLACK_TEAM_ID', label: 'Team ID', labelZh: '团队 ID', required: true, secret: false, placeholder: 'T...' },
    ],
    defaultAutoApprove: ['list_channels', 'get_channel_history', 'search_messages'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    official: true,
    tags: ['slack', 'chat', 'team'],
    usageExamples: ['Show recent messages in #general', 'Search for messages about deployment', 'List all channels'],
    usageExamplesZh: ['显示 #general 的最近消息', '搜索关于部署的消息', '列出所有频道'],
  },
  {
    type: 'local',
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search and read files from Google Drive',
    descriptionZh: '搜索和读取 Google Drive 文件',
    category: 'productivity',
    icon: 'FolderOpen',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    envConfig: [
      { key: 'GDRIVE_CREDENTIALS_PATH', label: 'Credentials Path', labelZh: '凭证文件路径', description: 'Path to Google OAuth credentials JSON file', descriptionZh: 'Google OAuth 凭证 JSON 文件路径', required: true, secret: false },
    ],
    defaultAutoApprove: ['search_files', 'read_file'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    official: true,
    tags: ['google', 'drive', 'files'],
    usageExamples: ['Search for project proposal documents', 'Read the content of my budget spreadsheet', 'Find files modified this week'],
    usageExamplesZh: ['搜索项目提案文档', '读取我的预算表格内容', '查找本周修改的文件'],
  },

  // ===== 设计工具类 =====
  {
    type: 'local',
    id: 'figma',
    name: 'Figma',
    description: 'Figma MCP server — inspect designs, components, styles via Personal Access Token',
    descriptionZh: 'Figma MCP 服务器 — 通过个人访问令牌检查设计、组件、样式',
    category: 'design',
    icon: 'Figma',
    command: 'npx',
    args: ['-y', '@hapins/figma-mcp'],
    envConfig: [
      {
        key: 'FIGMA_ACCESS_TOKEN',
        label: 'Figma Personal Access Token',
        labelZh: 'Figma 个人访问令牌',
        description: 'Get from Figma Settings > Security > Personal access tokens',
        descriptionZh: '从 Figma 设置 > 安全 > 个人访问令牌获取',
        required: true,
        secret: true,
        placeholder: 'figd_...',
      },
    ],
    defaultAutoApprove: ['get_file', 'get_node', 'get_component', 'get_style'],
    requiresConfig: true,
    docsUrl: 'https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens',
    tags: ['figma', 'design', 'ui', 'components', 'styles'],
    usageExamples: ['Get the design of my Figma file: [Figma URL]', 'Inspect components in my file', 'Get color styles from Figma'],
    usageExamplesZh: ['获取我的 Figma 文件设计：[Figma URL]', '检查文件中的组件', '获取 Figma 的颜色样式'],
  },
  {
    type: 'remote',
    id: 'figma-desktop',
    name: 'Figma Desktop',
    description: 'Connect to local Figma desktop app MCP server — no OAuth, instant access',
    descriptionZh: '连接本地 Figma 桌面应用的 MCP 服务器，无需 OAuth，即开即用',
    category: 'design',
    icon: 'Figma',
    url: 'http://127.0.0.1:3845/mcp',
    envConfig: [],
    defaultAutoApprove: ['get_file', 'get_node', 'get_local_variables', 'get_code_connect_map'],
    requiresConfig: false,
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
    official: true,
    tags: ['figma', 'design', 'ui', 'desktop', 'local'],
    setupNote: 'Requires Figma desktop app (v116+) with MCP server enabled in Settings > Feature flags.',
    setupNoteZh: '需要安装 Figma 桌面应用（v116+），并在设置 > 功能标志中启用 MCP 服务器。',
    usageExamples: ['Get the design of my Figma file: [Figma URL]', 'Read local variables in my design file', 'Export component code from Figma'],
    usageExamplesZh: ['获取我的 Figma 文件设计：[Figma URL]', '读取设计文件中的本地变量', '从 Figma 导出组件代码'],
  },
  {
    type: 'local',
    id: 'context7',
    name: 'Context7',
    description: 'Get up-to-date documentation for any library directly in your prompts',
    descriptionZh: '在提示中直接获取任何库的最新文档',
    category: 'development',
    icon: 'BookOpen',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    envConfig: [],
    defaultAutoApprove: ['resolve-library-id', 'get-library-docs'],
    requiresConfig: false,
    docsUrl: 'https://github.com/upstash/context7',
    tags: ['docs', 'library', 'documentation'],
    usageExamples: ['How to use React Query useQuery hook?', 'Show me Tailwind CSS flexbox utilities', 'Get Next.js App Router documentation'],
    usageExamplesZh: ['如何使用 React Query 的 useQuery hook？', '显示 Tailwind CSS 的 flexbox 工具类', '获取 Next.js App Router 文档'],
  },

  // ===== 推理增强 =====
  {
    type: 'local',
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Dynamic step-by-step reasoning for complex problem solving',
    descriptionZh: '动态逐步推理，帮助解决复杂问题',
    category: 'ai',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    envConfig: [],
    defaultAutoApprove: ['sequentialthinking'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    official: true,
    tags: ['reasoning', 'thinking', 'chain-of-thought'],
    usageExamples: ['Break down this complex architecture decision step by step', 'Help me think through the pros and cons of this approach'],
    usageExamplesZh: ['一步步分析这个复杂的架构决策', '帮我逐步思考这个方案的利弊'],
  },

  // ===== 免费搜索 =====
  {
    type: 'local',
    id: 'duckduckgo',
    name: 'DuckDuckGo Search',
    description: 'Free web search using DuckDuckGo — no API key required',
    descriptionZh: '使用 DuckDuckGo 进行免费网络搜索，无需 API 密钥',
    category: 'search',
    icon: 'Search',
    command: 'uvx',
    args: ['duckduckgo-mcp-server'],
    envConfig: [],
    defaultAutoApprove: ['search'],
    requiresConfig: false,
    docsUrl: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    tags: ['search', 'free', 'web'],
    usageExamples: ['Search for the latest news about AI', 'Find tutorials about TypeScript'],
    usageExamplesZh: ['搜索 AI 最新动态', '查找 TypeScript 教程'],
    dependencies: [
      { type: 'uv', checkCommand: 'uvx --version', installNote: 'Install uv: https://docs.astral.sh/uv/', installNoteZh: '安装 uv: https://docs.astral.sh/uv/' },
    ],
  },

  // ===== 时间工具 =====
  {
    type: 'local',
    id: 'time',
    name: 'Time',
    description: 'Get current time and perform timezone conversions',
    descriptionZh: '获取当前时间并进行时区转换',
    category: 'other',
    icon: 'Clock',
    command: 'uvx',
    args: ['mcp-server-time', '--local-timezone', '${LOCAL_TIMEZONE}'],
    envConfig: [
      { key: 'LOCAL_TIMEZONE', label: 'Local Timezone', labelZh: '本地时区', required: false, secret: false, defaultValue: 'Asia/Shanghai', placeholder: 'Asia/Shanghai' },
    ],
    defaultAutoApprove: ['get_current_time', 'convert_time'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    official: true,
    tags: ['time', 'timezone', 'utility'],
    usageExamples: ['What time is it now in Tokyo?', 'Convert 3pm EST to Beijing time'],
    usageExamplesZh: ['现在东京是几点？', '将美东时间下午3点转换为北京时间'],
    dependencies: [
      { type: 'uv', checkCommand: 'uvx --version', installNote: 'Install uv: https://docs.astral.sh/uv/', installNoteZh: '安装 uv: https://docs.astral.sh/uv/' },
    ],
  },

  // ===== 数据库/后端 =====
  {
    type: 'local',
    id: 'supabase',
    name: 'Supabase',
    description: 'Query and manage your Supabase database, auth, and storage',
    descriptionZh: '查询和管理 Supabase 数据库、认证和存储',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase@latest', '--access-token', '${SUPABASE_ACCESS_TOKEN}'],
    envConfig: [
      { key: 'SUPABASE_ACCESS_TOKEN', label: 'Access Token', labelZh: '访问令牌', description: 'Get from Supabase Dashboard > Account > Access Tokens', descriptionZh: '从 Supabase 控制台 > 账户 > 访问令牌获取', required: true, secret: true },
    ],
    defaultAutoApprove: ['list_projects', 'list_tables', 'execute_sql'],
    requiresConfig: true,
    docsUrl: 'https://github.com/supabase-community/supabase-mcp',
    official: true,
    tags: ['supabase', 'database', 'backend', 'postgres'],
    usageExamples: ['List all tables in my Supabase project', 'Query users from my database', 'Show storage buckets'],
    usageExamplesZh: ['列出 Supabase 项目中的所有表', '从数据库查询用户', '显示存储桶'],
  },

  // ===== 项目管理 =====
  {
    type: 'local',
    id: 'jira',
    name: 'Jira',
    description: 'Manage Jira issues, sprints, and projects',
    descriptionZh: '管理 Jira 问题、迭代和项目',
    category: 'development',
    icon: 'ListOrdered',
    command: 'npx',
    args: ['-y', 'mcp-atlassian'],
    envConfig: [
      { key: 'JIRA_URL', label: 'Jira URL', labelZh: 'Jira 地址', required: true, secret: false, placeholder: 'https://your-org.atlassian.net' },
      { key: 'JIRA_USERNAME', label: 'Email', labelZh: '邮箱', required: true, secret: false, placeholder: 'you@company.com' },
      { key: 'JIRA_API_TOKEN', label: 'API Token', labelZh: 'API 令牌', description: 'Create at https://id.atlassian.com/manage-profile/security/api-tokens', descriptionZh: '在 https://id.atlassian.com/manage-profile/security/api-tokens 创建', required: true, secret: true },
    ],
    defaultAutoApprove: ['list_issues', 'get_issue', 'search_issues'],
    requiresConfig: true,
    docsUrl: 'https://github.com/sooperset/mcp-atlassian',
    tags: ['jira', 'project', 'atlassian', 'issues'],
    usageExamples: ['Show my assigned Jira issues', 'Find all bugs in current sprint', 'Get details of PROJ-123'],
    usageExamplesZh: ['显示分配给我的 Jira 问题', '查找当前迭代中的所有 Bug', '获取 PROJ-123 的详情'],
  },

  // ===== 支付 =====
  {
    type: 'local',
    id: 'stripe',
    name: 'Stripe',
    description: 'Manage Stripe payments, customers, subscriptions, and more',
    descriptionZh: '管理 Stripe 支付、客户、订阅等',
    category: 'development',
    icon: 'Boxes',
    command: 'npx',
    args: ['-y', '@stripe/mcp', '--tools=all'],
    envConfig: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', labelZh: '密钥', description: 'Find in Stripe Dashboard > Developers > API keys', descriptionZh: '在 Stripe 控制台 > 开发者 > API 密钥中找到', required: true, secret: true, placeholder: 'sk_...' },
    ],
    defaultAutoApprove: ['list_customers', 'list_products', 'list_invoices', 'retrieve_balance'],
    requiresConfig: true,
    docsUrl: 'https://github.com/stripe/agent-toolkit',
    official: true,
    tags: ['stripe', 'payment', 'billing'],
    usageExamples: ['Show recent Stripe payments', 'List all active subscriptions', 'Find customers with failed payments'],
    usageExamplesZh: ['显示最近的 Stripe 收款', '列出所有活跃订阅', '查找支付失败的客户'],
  },

  // ===== 文件系统类 =====
  {
    type: 'local',
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Secure file operations with configurable access control',
    descriptionZh: '安全的文件操作，可配置访问控制',
    category: 'filesystem',
    icon: 'FolderOpen',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${ALLOWED_PATH}'],
    envConfig: [
      { key: 'ALLOWED_PATH', label: 'Allowed Directory', labelZh: '允许访问的目录', description: 'Directory path that the server can access', descriptionZh: '服务器可以访问的目录路径', required: true, secret: false, placeholder: '/path/to/directory' },
    ],
    defaultAutoApprove: ['read_file', 'read_multiple_files', 'list_directory', 'directory_tree', 'search_files', 'get_file_info'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    official: true,
    tags: ['files', 'local', 'sandbox'],
    usageExamples: ['List files in the project directory', 'Read the content of config.json', 'Search for all .ts files'],
    usageExamplesZh: ['列出项目目录中的文件', '读取 config.json 的内容', '搜索所有 .ts 文件'],
  },
]

/** 根据分类获取预设 */
export function getPresetsByCategory(category: McpPresetCategory): McpPreset[] {
  return MCP_PRESETS.filter(p => p.category === category)
}

/** 根据 ID 获取预设 */
export function getPresetById(id: string): McpPreset | undefined {
  return MCP_PRESETS.find(p => p.id === id)
}

/** 获取所有分类 */
export function getAllCategories(): McpPresetCategory[] {
  const categories = new Set(MCP_PRESETS.map(p => p.category))
  return Array.from(categories)
}

/** 搜索预设 */
export function searchPresets(query: string): McpPreset[] {
  const lowerQuery = query.toLowerCase()
  return MCP_PRESETS.filter(p =>
    p.name.toLowerCase().includes(lowerQuery) ||
    p.description.toLowerCase().includes(lowerQuery) ||
    p.descriptionZh.includes(query) ||
    p.tags?.some(t => t.toLowerCase().includes(lowerQuery))
  )
}

/** 获取当前平台 */
export function getCurrentPlatform(): McpPlatform {
  if (runtimePlatform.isWindows) return 'windows'
  if (runtimePlatform.isMac) return 'macos'
  return 'linux'
}

/** 检查预设是否支持当前平台 */
export function isPresetSupportedOnCurrentPlatform(preset: McpPreset): boolean {
  if (!preset.platforms || preset.platforms.length === 0) {
    return true // 不指定则支持所有平台
  }
  return preset.platforms.includes(getCurrentPlatform())
}

/** 获取预设的依赖检查命令 */
export function getPresetDependencyChecks(preset: McpPreset): Array<{ type: McpDependencyType; command: string }> {
  if (!preset.dependencies) return []

  return preset.dependencies
    .filter(dep => dep.checkCommand)
    .map(dep => ({
      type: dep.type,
      command: dep.checkCommand!,
    }))
}

/** 获取预设的缺失依赖提示 */
export function getPresetMissingDependencyNote(preset: McpPreset, missingType: McpDependencyType, language: 'en' | 'zh'): string | undefined {
  const dep = preset.dependencies?.find(d => d.type === missingType)
  if (!dep) return undefined
  return language === 'zh' ? dep.installNoteZh : dep.installNote
}

/** 根据平台过滤预设 */
export function getPresetsForCurrentPlatform(): McpPreset[] {
  return MCP_PRESETS.filter(p => !p.deprecated && isPresetSupportedOnCurrentPlatform(p))
}
