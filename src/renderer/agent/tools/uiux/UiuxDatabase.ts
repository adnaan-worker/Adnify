/**
 * UI/UX 数据库管理
 * 加载和管理 UI/UX 设计数据
 */

import { api } from '@/renderer/services/electronAPI'
import { BM25Searcher } from './BM25Engine'
import {
  type UiuxDomain,
  type TechStack,
  type UiuxSearchResult,
  DOMAIN_CONFIGS,
  STACK_CONFIG,
  AVAILABLE_STACKS,
} from './types'
import { logger } from '@shared/utils/Logger'

/** 数据文件映射 */
const DATA_FILES: Record<UiuxDomain, string> = {
  style: 'styles.json',
  prompt: 'prompts.json',
  color: 'colors.json',
  chart: 'charts.json',
  landing: 'landing.json',
  product: 'products.json',
  ux: 'ux-guidelines.json',
  typography: 'typography.json',
}

/** 域关键词映射（用于自动检测） */
const DOMAIN_KEYWORDS: Record<UiuxDomain, string[]> = {
  color: ['color', 'palette', 'hex', '#', 'rgb'],
  chart: ['chart', 'graph', 'visualization', 'trend', 'bar', 'pie', 'scatter', 'heatmap', 'funnel'],
  landing: ['landing', 'page', 'cta', 'conversion', 'hero', 'testimonial', 'pricing', 'section'],
  product: ['saas', 'ecommerce', 'e-commerce', 'fintech', 'healthcare', 'gaming', 'portfolio', 'crypto', 'dashboard'],
  prompt: ['prompt', 'css', 'implementation', 'variable', 'checklist', 'tailwind'],
  style: ['style', 'design', 'ui', 'minimalism', 'glassmorphism', 'neumorphism', 'brutalism', 'dark mode', 'flat', 'aurora'],
  ux: ['ux', 'usability', 'accessibility', 'wcag', 'touch', 'scroll', 'animation', 'keyboard', 'navigation', 'mobile'],
  typography: ['font', 'typography', 'heading', 'serif', 'sans'],
}

/**
 * UI/UX 数据库类
 */
class UiuxDatabase {
  private searchers = new Map<string, BM25Searcher<Record<string, unknown>>>()
  private dataCache = new Map<string, Record<string, unknown>[]>()
  private initialized = false

  /**
   * 初始化数据库
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // 数据路径将在运行时通过 Electron 获取
    // 这里只标记为已初始化，实际数据按需加载
    this.initialized = true
  }

  /**
   * 加载域数据
   */
  private async loadDomainData(domain: UiuxDomain): Promise<Record<string, unknown>[]> {
    const cacheKey = `domain:${domain}`
    
    if (this.dataCache.has(cacheKey)) {
      return this.dataCache.get(cacheKey)!
    }

    try {
      const fileName = DATA_FILES[domain]
      const data = await this.loadJsonFile(`data/${fileName}`)
      this.dataCache.set(cacheKey, data)
      return data
    } catch (error) {
      logger.tool.error(`[UiuxDatabase] Failed to load ${domain} data:`, error)
      return []
    }
  }

  /**
   * 加载技术栈数据
   */
  private async loadStackData(stack: TechStack): Promise<Record<string, unknown>[]> {
    const cacheKey = `stack:${stack}`
    
    if (this.dataCache.has(cacheKey)) {
      return this.dataCache.get(cacheKey)!
    }

    try {
      const data = await this.loadJsonFile(`data/stacks/${stack}.json`)
      this.dataCache.set(cacheKey, data)
      return data
    } catch (error) {
      logger.tool.error(`[UiuxDatabase] Failed to load ${stack} stack data:`, error)
      return []
    }
  }

  /**
   * 加载 JSON 文件
   */
  private async loadJsonFile(relativePath: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await api.resources.readJson<Record<string, unknown>[]>(`uiux/${relativePath}`)
      if (result.success && result.data) {
        return result.data
      }
      logger.tool.error(`[UiuxDatabase] Failed to load ${relativePath}:`, result.error)
      return []
    } catch (error) {
      logger.tool.error(`[UiuxDatabase] Failed to load ${relativePath}:`, error)
      return []
    }
  }

  /**
   * 获取或创建搜索器
   */
  private async getSearcher(key: string, data: Record<string, unknown>[], searchFields: string[]): Promise<BM25Searcher<Record<string, unknown>>> {
    if (!this.searchers.has(key)) {
      const searcher = new BM25Searcher<Record<string, unknown>>()
      searcher.initialize(data, searchFields)
      this.searchers.set(key, searcher)
    }
    return this.searchers.get(key)!
  }

  /**
   * 自动检测查询的最佳域
   */
  detectDomain(query: string): UiuxDomain {
    const queryLower = query.toLowerCase()
    
    const scores: Record<string, number> = {
      style: 0,
      color: 0,
      typography: 0,
      chart: 0,
      landing: 0,
      product: 0,
      ux: 0,
      prompt: 0,
    }

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      scores[domain] = keywords.filter(kw => queryLower.includes(kw)).length
    }

    const best = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)
    return best[1] > 0 ? best[0] as UiuxDomain : 'style'
  }

  /**
   * 搜索域数据
   */
  async search(query: string, domain?: UiuxDomain, maxResults = 3): Promise<UiuxSearchResult> {
    const targetDomain = domain || this.detectDomain(query)
    const config = DOMAIN_CONFIGS[targetDomain]
    
    const data = await this.loadDomainData(targetDomain)
    if (data.length === 0) {
      return {
        domain: targetDomain,
        query,
        count: 0,
        results: [],
      }
    }

    const searcher = await this.getSearcher(`domain:${targetDomain}`, data, config.searchFields)
    const results = searcher.search(query, maxResults)

    // 只返回输出字段
    const filteredResults = results.map(r => {
      const filtered: Record<string, unknown> = {}
      for (const field of config.outputFields) {
        if (field in r.item) {
          filtered[field] = r.item[field]
        }
      }
      return filtered
    })

    return {
      domain: targetDomain,
      query,
      count: filteredResults.length,
      results: filteredResults,
    }
  }

  /**
   * 搜索技术栈指南
   */
  async searchStack(query: string, stack: TechStack, maxResults = 3): Promise<UiuxSearchResult> {
    if (!AVAILABLE_STACKS.includes(stack)) {
      return {
        domain: 'stack',
        stack,
        query,
        count: 0,
        results: [],
      }
    }

    const data = await this.loadStackData(stack)
    if (data.length === 0) {
      return {
        domain: 'stack',
        stack,
        query,
        count: 0,
        results: [],
      }
    }

    const searcher = await this.getSearcher(`stack:${stack}`, data, STACK_CONFIG.searchFields)
    const results = searcher.search(query, maxResults)

    // 只返回输出字段
    const filteredResults = results.map(r => {
      const filtered: Record<string, unknown> = {}
      for (const field of STACK_CONFIG.outputFields) {
        if (field in r.item) {
          filtered[field] = r.item[field]
        }
      }
      return filtered
    })

    return {
      domain: 'stack',
      stack,
      query,
      count: filteredResults.length,
      results: filteredResults,
    }
  }

  /**
   * 获取可用域列表
   */
  getAvailableDomains(): UiuxDomain[] {
    return Object.keys(DOMAIN_CONFIGS) as UiuxDomain[]
  }

  /**
   * 获取可用技术栈列表
   */
  getAvailableStacks(): TechStack[] {
    return AVAILABLE_STACKS
  }

  /**
   * 获取产品类型的完整设计推荐
   * 一次性返回风格+配色+字体的组合
   */
  async getRecommendation(productType: string): Promise<{
    product: Record<string, unknown> | null
    style: Record<string, unknown> | null
    prompt: Record<string, unknown> | null
    color: Record<string, unknown> | null
    typography: Record<string, unknown> | null
    landing: Record<string, unknown> | null
  }> {
    // 1. 搜索产品类型
    const productData = await this.loadDomainData('product')
    const productSearcher = await this.getSearcher('domain:product', productData, DOMAIN_CONFIGS.product.searchFields)
    const productResults = productSearcher.search(productType, 1)
    const product = productResults[0]?.item || null

    if (!product) {
      return { product: null, style: null, prompt: null, color: null, typography: null, landing: null }
    }

    // 2. 根据产品推荐的风格搜索风格详情
    const styleRecommendation = (product['Primary Style Recommendation'] as string) || ''
    const styleData = await this.loadDomainData('style')
    const styleSearcher = await this.getSearcher('domain:style', styleData, DOMAIN_CONFIGS.style.searchFields)
    const styleResults = styleSearcher.search(styleRecommendation.split('+')[0].trim(), 1)
    const style = styleResults[0]?.item || null

    // 3. 搜索对应的 prompt/CSS 关键词
    const promptData = await this.loadDomainData('prompt')
    const promptSearcher = await this.getSearcher('domain:prompt', promptData, DOMAIN_CONFIGS.prompt.searchFields)
    const promptResults = promptSearcher.search(styleRecommendation.split('+')[0].trim(), 1)
    const prompt = promptResults[0]?.item || null

    // 4. 根据产品类型搜索配色
    const colorData = await this.loadDomainData('color')
    const colorSearcher = await this.getSearcher('domain:color', colorData, DOMAIN_CONFIGS.color.searchFields)
    const colorResults = colorSearcher.search(productType, 1)
    const color = colorResults[0]?.item || null

    // 5. 根据风格搜索字体搭配
    const typographyData = await this.loadDomainData('typography')
    const typographySearcher = await this.getSearcher('domain:typography', typographyData, DOMAIN_CONFIGS.typography.searchFields)
    // 根据风格特点选择字体：现代风格用 sans，传统用 serif
    const fontQuery = styleRecommendation.toLowerCase().includes('minimal') || styleRecommendation.toLowerCase().includes('flat') 
      ? 'modern sans clean' 
      : productType
    const typographyResults = typographySearcher.search(fontQuery, 1)
    const typography = typographyResults[0]?.item || null

    // 6. 搜索 Landing Page 模式
    const landingPattern = (product['Landing Page Pattern'] as string) || ''
    const landingData = await this.loadDomainData('landing')
    const landingSearcher = await this.getSearcher('domain:landing', landingData, DOMAIN_CONFIGS.landing.searchFields)
    const landingResults = landingSearcher.search(landingPattern, 1)
    const landing = landingResults[0]?.item || null

    return { product, style, prompt, color, typography, landing }
  }
}

/** 单例实例 */
export const uiuxDatabase = new UiuxDatabase()
