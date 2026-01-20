/**
 * 统一的加载状态组件库
 * 提供一致的加载动画和骨架屏样式
 */
import { Loader2 } from 'lucide-react'
import { memo } from 'react'

// ============ 基础 Spinner ============

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
}

export const Spinner = memo(({ size = 'sm', className = '' }: SpinnerProps) => (
  <Loader2 className={`animate-spin text-accent ${sizeMap[size]} ${className}`} />
))
Spinner.displayName = 'Spinner'

// ============ 全屏加载 ============

interface FullScreenLoadingProps {
  message?: string
}

export const FullScreenLoading = memo(({ message }: FullScreenLoadingProps) => (
  <div className="h-full flex flex-col items-center justify-center gap-3 bg-background">
    <Spinner size="lg" />
    {message && <span className="text-xs text-text-muted">{message}</span>}
  </div>
))
FullScreenLoading.displayName = 'FullScreenLoading'

// ============ 面板加载骨架屏（侧边栏） ============

export const PanelSkeleton = memo(() => (
  <div className="h-full flex flex-col bg-background border-r border-border">
    {/* 标题栏 */}
    <div className="h-10 px-4 flex items-center justify-between border-b border-border">
      <div className="h-3 w-16 bg-surface-active/50 rounded animate-pulse" />
      <div className="flex items-center gap-1">
        <div className="w-6 h-6 bg-surface-active/30 rounded animate-pulse" />
        <div className="w-6 h-6 bg-surface-active/30 rounded animate-pulse" />
        <div className="w-6 h-6 bg-surface-active/30 rounded animate-pulse" />
      </div>
    </div>
    {/* 文件树区域 */}
    <div className="flex-1 p-2 flex flex-col gap-0.5 overflow-hidden">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-1.5 animate-pulse"
          style={{ paddingLeft: `${8 + (i % 4) * 12}px` }}
        >
          <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />
          <div
            className="h-3.5 bg-surface-active/30 rounded"
            style={{ width: `${Math.max(40, 85 - i * 5)}%` }}
          />
        </div>
      ))}
    </div>
    {/* Git 状态栏 */}
    <div className="px-3 py-2 border-t border-border">
      <div className="flex items-center gap-2 animate-pulse">
        <div className="w-3.5 h-3.5 bg-surface-active/50 rounded" />
        <div className="h-3 w-16 bg-surface-active/30 rounded" />
      </div>
    </div>
  </div>
))
PanelSkeleton.displayName = 'PanelSkeleton'

// ============ 编辑器骨架屏 ============

export const EditorSkeleton = memo(() => (
  <div className="h-full w-full flex flex-col bg-background">
    {/* 标签栏 */}
    <div className="h-9 border-b border-border flex items-center px-2 gap-1">
      <div className="h-6 w-24 bg-surface-active/50 rounded animate-pulse" />
      <div className="h-6 w-20 bg-surface-active/30 rounded animate-pulse" />
    </div>
    {/* 代码区域 */}
    <div className="flex-1 p-4 flex flex-col gap-2">
      {[...Array(15)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          {/* 行号 */}
          <div className="w-8 h-4 bg-surface-active/30 rounded flex-shrink-0" />
          {/* 代码行 */}
          <div
            className="h-4 bg-surface-active/40 rounded"
            style={{
              width: `${Math.max(20, 70 - ((i * 5) % 50))}%`,
              marginLeft: `${(i % 3) * 16}px`,
            }}
          />
        </div>
      ))}
    </div>
  </div>
))
EditorSkeleton.displayName = 'EditorSkeleton'

// ============ 聊天面板骨架屏 ============

export const ChatSkeleton = memo(() => (
  <div className="h-full flex flex-col bg-background">
    {/* Header */}
    <div className="h-10 border-b border-border flex items-center justify-between px-4">
      <div className="h-4 w-12 bg-surface-active/50 rounded animate-pulse" />
      <div className="flex gap-2">
        <div className="w-5 h-5 bg-surface-active/30 rounded animate-pulse" />
        <div className="w-5 h-5 bg-surface-active/30 rounded animate-pulse" />
        <div className="w-5 h-5 bg-surface-active/30 rounded animate-pulse" />
      </div>
    </div>
    {/* Messages */}
    <div className="flex-1 p-4 space-y-6 overflow-hidden">
      {/* AI 消息 */}
      <div className="flex gap-3 animate-pulse">
        <div className="w-7 h-7 bg-surface-active/50 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-16 bg-surface-active/50 rounded" />
          <div className="space-y-1.5">
            <div className="h-3 bg-surface-active/30 rounded w-[90%]" />
            <div className="h-3 bg-surface-active/30 rounded w-[75%]" />
            <div className="h-3 bg-surface-active/30 rounded w-[60%]" />
          </div>
        </div>
      </div>
      {/* 用户消息 */}
      <div className="flex gap-3 animate-pulse">
        <div className="w-7 h-7 bg-surface-active/50 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-12 bg-surface-active/50 rounded" />
          <div className="h-3 bg-surface-active/30 rounded w-[40%]" />
        </div>
      </div>
      {/* AI 消息 */}
      <div className="flex gap-3 animate-pulse">
        <div className="w-7 h-7 bg-surface-active/50 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-16 bg-surface-active/50 rounded" />
          <div className="space-y-1.5">
            <div className="h-3 bg-surface-active/30 rounded w-[85%]" />
            <div className="h-3 bg-surface-active/30 rounded w-[70%]" />
          </div>
        </div>
      </div>
    </div>
    {/* Input */}
    <div className="p-3 border-t border-border">
      <div className="h-16 bg-surface-active/30 rounded-xl animate-pulse" />
    </div>
  </div>
))
ChatSkeleton.displayName = 'ChatSkeleton'

// ============ 列表骨架屏 ============

interface ListSkeletonProps {
  rows?: number
  showIcon?: boolean
}

export const ListSkeleton = memo(({ rows = 5, showIcon = true }: ListSkeletonProps) => (
  <div className="flex flex-col gap-1 p-2">
    {[...Array(rows)].map((_, i) => (
      <div key={i} className="flex items-center gap-2 p-2 animate-pulse">
        {showIcon && <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />}
        <div
          className="h-4 bg-surface-active/30 rounded"
          style={{ width: `${Math.max(40, 90 - i * 12)}%` }}
        />
      </div>
    ))}
  </div>
))
ListSkeleton.displayName = 'ListSkeleton'

// ============ 代码块骨架屏 ============

interface CodeSkeletonProps {
  lines?: number
}

export const CodeSkeleton = memo(({ lines = 5 }: CodeSkeletonProps) => (
  <div className="h-full w-full p-4 flex flex-col gap-3 select-none bg-surface/20">
    {[...Array(lines)].map((_, i) => (
      <div key={i} className="flex items-center gap-4 animate-pulse">
        <div className="w-8 h-3 bg-surface-active/40 rounded-sm shrink-0" />
        <div
          className="h-3 bg-surface-active/30 rounded-sm"
          style={{
            width: `${Math.max(30, 85 - (i * 15) % 50)}%`,
            opacity: 0.7 - i * 0.1,
          }}
        />
      </div>
    ))}
  </div>
))
CodeSkeleton.displayName = 'CodeSkeleton'

// ============ 内联加载指示器 ============

interface InlineLoadingProps {
  text?: string
  size?: 'xs' | 'sm'
}

export const InlineLoading = memo(({ text, size = 'sm' }: InlineLoadingProps) => (
  <div className="flex items-center gap-2 text-text-muted">
    <Spinner size={size} />
    {text && <span className={size === 'xs' ? 'text-[10px]' : 'text-xs'}>{text}</span>}
  </div>
))
InlineLoading.displayName = 'InlineLoading'


// ============ 设置弹窗骨架屏 ============

export const SettingsSkeleton = memo(() => (
  <div className="flex h-[75vh] max-h-[800px] bg-background rounded-xl overflow-hidden">
    {/* 左侧导航栏 */}
    <div className="w-64 bg-surface-active/30 border-r border-border flex flex-col pt-6 pb-4">
      <div className="px-6 mb-6">
        <div className="h-5 w-16 bg-surface-active/50 rounded animate-pulse" />
      </div>
      <nav className="flex-1 px-3 space-y-1.5">
        {[...Array(11)].map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3.5 px-4 py-3 rounded-xl animate-pulse ${i === 0 ? 'bg-accent/10' : ''}`}
          >
            <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />
            <div className="h-3 bg-surface-active/50 rounded" style={{ width: `${60 + (i % 3) * 15}%` }} />
          </div>
        ))}
      </nav>
      <div className="mt-auto px-4 pt-4 border-t border-border space-y-3">
        <div className="flex items-center gap-2 px-2">
          <div className="w-4 h-4 bg-surface-active/50 rounded animate-pulse" />
          <div className="h-3 w-12 bg-surface-active/50 rounded animate-pulse" />
        </div>
        <div className="h-9 bg-surface-active/30 rounded-lg animate-pulse" />
      </div>
    </div>
    {/* 右侧内容区 */}
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 p-8 space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-32 bg-surface-active/50 rounded animate-pulse" />
          <div className="h-4 w-64 bg-surface-active/30 rounded animate-pulse" />
        </div>
        <div className="space-y-4 pt-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2 animate-pulse">
              <div className="h-4 w-24 bg-surface-active/50 rounded" />
              <div className="h-10 bg-surface-active/30 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
      <div className="px-8 py-5 border-t border-border flex items-center justify-end gap-3">
        <div className="h-9 w-16 bg-surface-active/30 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-accent/20 rounded-lg animate-pulse" />
      </div>
    </div>
  </div>
))
SettingsSkeleton.displayName = 'SettingsSkeleton'
