/**
 * HTTP 服务 IPC handlers
 * 提供网络请求能力给渲染进程
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain } from 'electron'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

// ===== 读取 URL 内容 =====

interface ReadUrlResult {
    success: boolean
    content?: string
    title?: string
    error?: string
    contentType?: string
    statusCode?: number
}

/**
 * 使用 Jina Reader API 读取 URL 内容
 * Jina Reader 专为 LLM 优化，支持 JS 渲染页面
 * 免费无限制使用
 */
async function fetchWithJinaReader(url: string, timeout = 60000): Promise<ReadUrlResult> {
    return new Promise((resolve) => {
        const options = {
            hostname: 'r.jina.ai',
            port: 443,
            path: `/${url}`,
            method: 'GET',
            headers: {
                'Accept': 'text/plain',
                'User-Agent': 'Adnify/1.0 (AI Code Editor)',
            },
            timeout,
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')

            res.on('data', (chunk) => {
                data += chunk
                // 限制响应大小
                if (data.length > 500000) {
                    req.destroy()
                    resolve({
                        success: true,
                        content: data.slice(0, 500000) + '\n\n...(truncated, content too large)',
                        statusCode: res.statusCode,
                        contentType: 'text/plain',
                    })
                }
            })

            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    resolve({
                        success: false,
                        error: `Jina Reader returned status ${res.statusCode}`,
                        statusCode: res.statusCode,
                    })
                    return
                }

                // 从 Jina 返回的 Markdown 中提取标题
                let title = ''
                const titleMatch = data.match(/^#\s+(.+)$/m)
                if (titleMatch) {
                    title = titleMatch[1].trim()
                }

                resolve({
                    success: true,
                    content: data,
                    title,
                    statusCode: res.statusCode,
                    contentType: 'text/markdown',
                })
            })
        })

        req.on('error', (error) => {
            resolve({
                success: false,
                error: `Jina Reader request failed: ${error.message}`,
            })
        })

        req.on('timeout', () => {
            req.destroy()
            resolve({
                success: false,
                error: 'Jina Reader request timed out',
            })
        })

        req.end()
    })
}

/**
 * 直接抓取 URL 内容（备用方案）
 */
async function fetchUrlDirect(url: string, timeout = 60000): Promise<ReadUrlResult> {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(url)
            const protocol = parsedUrl.protocol === 'https:' ? https : http

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
                },
                timeout,
            }

            const req = protocol.request(options, (res) => {
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`
                    fetchUrlDirect(redirectUrl, timeout).then(resolve)
                    return
                }

                let data = ''
                const contentType = res.headers['content-type'] || ''

                // 检查是否是文本内容
                if (!contentType.includes('text') &&
                    !contentType.includes('json') &&
                    !contentType.includes('xml') &&
                    !contentType.includes('javascript')) {
                    resolve({
                        success: false,
                        error: `Unsupported content type: ${contentType}`,
                        statusCode: res.statusCode,
                        contentType,
                    })
                    req.destroy()
                    return
                }

                res.setEncoding('utf8')
                res.on('data', (chunk) => {
                    data += chunk
                    // 限制响应大小
                    if (data.length > 500000) {
                        req.destroy()
                        resolve({
                            success: true,
                            content: data.slice(0, 500000) + '\n\n...(truncated, content too large)',
                            statusCode: res.statusCode,
                            contentType,
                        })
                    }
                })

                res.on('end', () => {
                    // 提取 HTML 标题
                    let title = ''
                    const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i)
                    if (titleMatch) {
                        title = titleMatch[1].trim()
                    }

                    // HTML 到文本转换
                    let content = data
                    if (contentType.includes('html')) {
                        content = htmlToText(data)
                    }

                    resolve({
                        success: true,
                        content,
                        title,
                        statusCode: res.statusCode,
                        contentType,
                    })
                })
            })

            req.on('error', (error) => {
                resolve({
                    success: false,
                    error: `Request failed: ${error.message}`,
                })
            })

            req.on('timeout', () => {
                req.destroy()
                resolve({
                    success: false,
                    error: 'Request timed out',
                })
            })

            req.end()
        } catch (error) {
            resolve({
                success: false,
                error: `Invalid URL: ${error}`,
            })
        }
    })
}

/**
 * 读取 URL 内容
 * 优先使用 Jina Reader，失败时回退到直接抓取
 */
async function fetchUrl(url: string, timeout = 60000): Promise<ReadUrlResult> {
    // 对于非 HTTP(S) URL，直接返回错误
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
            success: false,
            error: 'Only HTTP and HTTPS URLs are supported',
        }
    }

    // 对于 JSON/API 端点，直接抓取更合适
    const isApiEndpoint = url.includes('/api/') ||
        url.endsWith('.json') ||
        url.includes('raw.githubusercontent.com') ||
        url.includes('api.github.com')

    if (isApiEndpoint) {
        logger.ipc.debug('[HTTP] API endpoint detected, using direct fetch')
        return fetchUrlDirect(url, timeout)
    }

    // 优先使用 Jina Reader
    logger.ipc.debug('[HTTP] Trying Jina Reader for:', url)
    const jinaResult = await fetchWithJinaReader(url, timeout)

    if (jinaResult.success) {
        logger.ipc.debug('[HTTP] Jina Reader succeeded')
        return jinaResult
    }

    // Jina 失败，回退到直接抓取
    logger.ipc.warn('[HTTP] Jina Reader failed, falling back to direct fetch:', jinaResult.error)
    return fetchUrlDirect(url, timeout)
}

// 简单的 HTML 到文本转换
function htmlToText(html: string): string {
    return html
        // 移除 script 和 style
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        // 移除 HTML 注释
        .replace(/<!--[\s\S]*?-->/g, '')
        // 转换常用标签
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        // 保留链接文本
        .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
        // 移除所有其他标签
        .replace(/<[^>]+>/g, '')
        // 解码 HTML 实体
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // 清理多余空白
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim()
}

// ===== 网络搜索 =====
// 优先级：Google PSE → DuckDuckGo

interface SearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResult {
    success: boolean
    results?: SearchResult[]
    error?: string
}

// 搜索 API 配置缓存
let cachedGoogleApiKey: string | null = null
let cachedGoogleCx: string | null = null

// 设置 Google PSE API 配置
export function setGoogleSearchConfig(apiKey: string, cx: string) {
    cachedGoogleApiKey = apiKey
    cachedGoogleCx = cx
    logger.ipc.info('[HTTP] Google PSE configured')
}

async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult> {
    // 优先使用 Google PSE（如果配置了）
    const googleApiKey = cachedGoogleApiKey || process.env.GOOGLE_API_KEY || ''
    const googleCx = cachedGoogleCx || process.env.GOOGLE_CX || ''

    if (googleApiKey && googleCx) {
        try {
            const result = await searchWithGoogle(query, googleApiKey, googleCx, maxResults)
            if (result.success && result.results && result.results.length > 0) {
                return result
            }
            logger.ipc.warn('[HTTP] Google PSE returned no results, falling back to DuckDuckGo')
        } catch (error) {
            logger.ipc.error('[HTTP] Google PSE failed, falling back to DuckDuckGo:', error)
        }
    }

    // 回退到 DuckDuckGo
    try {
        return await searchWithDuckDuckGo(query, maxResults)
    } catch (error) {
        logger.ipc.error('[HTTP] DuckDuckGo search failed:', error)
        return {
            success: false,
            error: `搜索失败: ${error}`,
        }
    }
}

// Google Programmable Search Engine API
async function searchWithGoogle(query: string, apiKey: string, cx: string, maxResults: number): Promise<WebSearchResult> {
    return new Promise((resolve) => {
        const encodedQuery = encodeURIComponent(query)
        const url = `/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}&num=${Math.min(maxResults, 10)}`

        const options = {
            hostname: 'www.googleapis.com',
            port: 443,
            path: url,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                try {
                    const json = JSON.parse(data)

                    // 检查 API 错误
                    if (json.error) {
                        resolve({
                            success: false,
                            error: `Google API error: ${json.error.message || json.error.code}`
                        })
                        return
                    }

                    const results: SearchResult[] = []
                    if (json.items) {
                        for (const item of json.items.slice(0, maxResults)) {
                            results.push({
                                title: item.title || '',
                                url: item.link || '',
                                snippet: item.snippet || '',
                            })
                        }
                    }

                    resolve({ success: true, results })
                } catch {
                    resolve({ success: false, error: 'Failed to parse Google response' })
                }
            })
        })

        req.on('error', (error) => {
            resolve({ success: false, error: `Google request failed: ${error.message}` })
        })

        req.setTimeout(10000, () => {
            req.destroy()
            resolve({ success: false, error: 'Google request timed out' })
        })

        req.end()
    })
}

// DuckDuckGo HTML 抓取
async function searchWithDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult> {
    return new Promise((resolve) => {
        const encodedQuery = encodeURIComponent(query)
        // 使用 DuckDuckGo 的 HTML 版本，更容易抓取
        const url = `/html/?q=${encodedQuery}`

        const options = {
            hostname: 'html.duckduckgo.com',
            port: 443,
            path: url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                try {
                    const results = parseDuckDuckGoHtml(data, maxResults)
                    resolve({ success: true, results })
                } catch (error) {
                    resolve({ success: false, error: `Failed to parse DuckDuckGo response: ${error}` })
                }
            })
        })

        req.on('error', (error) => {
            resolve({ success: false, error: `DuckDuckGo request failed: ${error.message}` })
        })

        req.setTimeout(15000, () => {
            req.destroy()
            resolve({ success: false, error: 'DuckDuckGo request timed out' })
        })

        req.end()
    })
}

// 解析 DuckDuckGo HTML 响应
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []

    // DuckDuckGo HTML 版本的结果在 class="result" 的 div 中
    // 标题在 class="result__a" 的 a 标签中
    // 摘要在 class="result__snippet" 的 a 标签中

    // 匹配结果块
    const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)<\/a>/gi

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1]
        const title = decodeHtmlEntities(match[2].trim())
        const snippet = decodeHtmlEntities(match[3].trim())

        // DuckDuckGo 的链接是重定向链接，需要提取真实 URL
        if (url.includes('uddg=')) {
            const uddgMatch = url.match(/uddg=([^&]+)/)
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1])
            }
        }

        if (title && url) {
            results.push({ title, url, snippet })
        }
    }

    // 如果上面的正则没匹配到，尝试更宽松的匹配
    if (results.length === 0) {
        const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi
        const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/gi

        const links: { url: string; title: string }[] = []
        const snippets: string[] = []

        while ((match = linkRegex.exec(html)) !== null) {
            let url = match[1]
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/)
                if (uddgMatch) url = decodeURIComponent(uddgMatch[1])
            }
            links.push({ url, title: decodeHtmlEntities(match[2].trim()) })
        }

        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(decodeHtmlEntities(match[1].trim()))
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: snippets[i] || '',
            })
        }
    }

    return results
}

// 解码 HTML 实体
function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
}

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
    // 读取 URL 内容
    ipcMain.handle('http:readUrl', async (_event, url: string, timeout?: number) => {
        logger.ipc.info('[HTTP] Reading URL:', url)
        return fetchUrl(url, timeout)
    })

    // 网络搜索
    ipcMain.handle('http:webSearch', async (_event, query: string, maxResults?: number) => {
        logger.ipc.info('[HTTP] Web search:', query)
        return webSearch(query, maxResults)
    })

    // 配置 Google PSE
    ipcMain.handle('http:setGoogleSearch', async (_event, apiKey: string, cx: string) => {
        setGoogleSearchConfig(apiKey, cx)
        return { success: true }
    })

    logger.ipc.info('[HTTP] IPC handlers registered')
}



