/**
 * HTTP 服务 IPC handlers
 * 提供网络请求能力给渲染进程
 */

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

async function fetchUrl(url: string, timeout = 30000): Promise<ReadUrlResult> {
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
                    'User-Agent': 'Adnify/1.0 (AI Code Editor)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
                },
                timeout,
            }

            const req = protocol.request(options, (res) => {
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

                    // 简单的 HTML 到文本转换
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
// 注意：真正的网络搜索需要 API key (如 SerpAPI, Google Custom Search, Bing Search)
// 这里提供一个框架，实际实现需要用户配置 API

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

async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult> {
    // 使用 DuckDuckGo Instant Answers API (免费，无需 key，但功能有限)
    // 或者可以后续集成 SerpAPI/Google API
    try {
        const encodedQuery = encodeURIComponent(query)
        const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`

        const result = await fetchUrl(url, 10000)

        if (!result.success || !result.content) {
            return {
                success: false,
                error: result.error || 'Search failed',
            }
        }

        try {
            const data = JSON.parse(result.content)
            const results: SearchResult[] = []

            // DuckDuckGo 返回的结构
            if (data.AbstractText) {
                results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL || '',
                    snippet: data.AbstractText,
                })
            }

            // 相关主题
            if (data.RelatedTopics) {
                for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
                    if (topic.Text && topic.FirstURL) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || topic.Text,
                            url: topic.FirstURL,
                            snippet: topic.Text,
                        })
                    }
                }
            }

            // 结果
            if (data.Results) {
                for (const r of data.Results.slice(0, maxResults - results.length)) {
                    if (r.Text && r.FirstURL) {
                        results.push({
                            title: r.Text,
                            url: r.FirstURL,
                            snippet: r.Text,
                        })
                    }
                }
            }

            return {
                success: true,
                results: results.slice(0, maxResults),
            }
        } catch {
            return {
                success: false,
                error: 'Failed to parse search results',
            }
        }
    } catch (error) {
        return {
            success: false,
            error: `Search error: ${error}`,
        }
    }
}

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
    // 读取 URL 内容
    ipcMain.handle('http:readUrl', async (_event, url: string, timeout?: number) => {
        console.log('[HTTP] Reading URL:', url)
        return fetchUrl(url, timeout)
    })

    // 网络搜索
    ipcMain.handle('http:webSearch', async (_event, query: string, maxResults?: number) => {
        console.log('[HTTP] Web search:', query)
        return webSearch(query, maxResults)
    })

    console.log('[HTTP] IPC handlers registered')
}
