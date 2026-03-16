/**
 * SafeHTML 组件 - 安全的 HTML 渲染组件
 * 
 * 功能：
 * 1. 使用 DOMPurify 净化 HTML，防止 XSS 攻击
 * 2. 支持自定义配置（允许的 tag、属性等）
 * 3. 处理空值、无效输入等边界情况
 * 4. 提供开发模式下的警告信息
 * 
 * 使用方式：
 * <SafeHTML html={htmlContent} />
 * <SafeHTML html={htmlContent} options={{ ALLOWED_TAGS: ['b', 'i'] }} />
 */

import { useMemo } from 'react'
import DOMPurify from 'dompurify'

export interface SafeHTMLOptions {
  /** 允许的 HTML 标签列表，默认为 undefined（允许所有安全标签） */
  ALLOWED_TAGS?: string[]
  /** 允许的 HTML 属性列表 */
  ALLOWED_ATTR?: string[]
  /** 是否允许 data-* 属性 */
  ALLOW_DATA_ATTR?: boolean
  /** 是否允许 HTML 中的 style 属性 */
  ALLOWED_URI_REGEXP?: RegExp
  /** 是否自动将相对 URL 转换为绝对 URL */
  FORCE_BODY?: boolean
  /** 自定义净化后处理 */
  KEEP_CONTENT?: boolean
  /** 是否转义而非净化（更严格） */
  SANITIZE_DOM?: boolean
  /** 是否允许 CSS */
  ALLOW_CSS?: boolean
}

export interface SafeHTMLProps {
  /** 要渲染的 HTML 字符串 */
  html: string | null | undefined
  /** 净化选项 */
  options?: SafeHTMLOptions
  /** 额外的 CSS 类名 */
  className?: string
  /** 渲染为指定的标签，默认为 'div' */
  as?: keyof JSX.IntrinsicElements
  /** 空内容时的占位符 */
  fallback?: React.ReactNode
  /** 是否显示净化前后的调试信息（仅开发模式） */
  debug?: boolean
  /** 点击事件 */
  onClick?: (event: React.MouseEvent) => void
  /** 额外的样式 */
  style?: React.CSSProperties
}

/**
 * 净化 HTML 内容
 */
function sanitizeHtml(html: string, options?: SafeHTMLOptions): string {
  if (typeof html !== 'string') {
    return ''
  }

  // 基础配置
  const defaultConfig: SafeHTMLOptions = {
    // 默认允许大部分常见标签，但会移除危险内容
    ALLOW_DATA_ATTR: false, // 默认不允许 data-* 属性，防止数据泄露
    SANITIZE_DOM: true,
    KEEP_CONTENT: true,
  }

  const config = { ...defaultConfig, ...options }

  try {
    return DOMPurify.sanitize(html, config)
  } catch (error) {
    console.error('[SafeHTML] Sanitization failed:', error)
    // 净化失败时返回转义后的纯文本（最安全的回退）
    return escapeHtml(html)
  }
}

/**
 * HTML 实体转义（最安全的回退方案）
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 检查内容是否包含危险代码（开发模式警告用）
 */
function containsDangerousContent(html: string): boolean {
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // onclick, onerror 等事件处理器
    /<iframe\b/gi,
    /<object\b/gi,
    /<embed\b/gi,
    /<form\b/gi,
  ]
  
  return dangerousPatterns.some(pattern => pattern.test(html))
}

/**
 * SafeHTML 组件
 */
export function SafeHTML({
  html,
  options,
  className,
  as: Component = 'div',
  fallback = null,
  debug = false,
  onClick,
  style,
}: SafeHTMLProps): JSX.Element {
  const sanitizedHtml = useMemo(() => {
    // 处理空值
    if (html == null || html === '') {
      return ''
    }

    const originalHtml = String(html)
    const cleaned = sanitizeHtml(originalHtml, options)

    // 开发模式调试信息
    if (debug && process.env.NODE_ENV === 'development') {
      console.log('[SafeHTML] Original:', originalHtml.slice(0, 200))
      console.log('[SafeHTML] Sanitized:', cleaned.slice(0, 200))
      
      if (containsDangerousContent(originalHtml)) {
        console.warn('[SafeHTML] Dangerous content detected and removed')
      }
    }

    return cleaned
  }, [html, options, debug])

  // 空内容时显示占位符
  if (sanitizedHtml === '') {
    return <>{fallback}</>
  }

  // 使用动态标签
  const Tag = Component as React.ElementType

  return (
    <Tag
      className={className}
      style={style}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}

/**
 * 简化的 SafeHTML 版本，仅渲染净化后的内容，无额外包裹元素
 * 适用于已知父元素的情况下
 */
export function useSafeHTML(html: string | null | undefined, options?: SafeHTMLOptions): string {
  return useMemo(() => {
    if (html == null || html === '') {
      return ''
    }
    return sanitizeHtml(String(html), options)
  }, [html, options])
}

/**
 * 安全的 Markdown HTML 渲染（更严格的配置）
 * 适用于 Markdown 内容的渲染
 */
export function SafeMarkdownHTML({
  html,
  className,
  ...props
}: Omit<SafeHTMLProps, 'options'>): JSX.Element {
  const markdownOptions: SafeHTMLOptions = {
    ALLOWED_TAGS: [
      'p', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre',
      'a', 'img',
      'blockquote', 'q',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
      'sup', 'sub',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', // 链接
      'src', 'alt', 'width', 'height', // 图片
      'class', 'id', // 通用
      'align', // 表格对齐
    ],
    ALLOW_DATA_ATTR: false,
  }

  return (
    <SafeHTML
      html={html}
      options={markdownOptions}
      className={className}
      {...props}
    />
  )
}

/**
 * 纯文本模式 - 移除所有 HTML 标签，只保留文本
 */
export function SafeText({
  html,
  className,
  fallback = '',
}: Pick<SafeHTMLProps, 'html' | 'className' | 'fallback'>): JSX.Element {
  const textContent = useMemo(() => {
    if (html == null || html === '') {
      return fallback as string
    }
    // 先净化，然后移除所有标签
    const cleaned = sanitizeHtml(String(html), { ALLOWED_TAGS: [] })
    // 移除剩余的标签（DOMPurify 应该已经做了，但双重保险）
    return cleaned.replace(/<[^>]+>/g, '')
  }, [html, fallback])

  return <span className={className}>{textContent}</span>
}

export default SafeHTML
