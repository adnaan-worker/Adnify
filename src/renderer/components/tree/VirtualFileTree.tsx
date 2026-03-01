/**
 * 虚拟化文件树组件
 * 只渲染可见区域的节点，提升大目录性能
 */
import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  Edit2,
  Trash2,
  Copy,
  Clipboard,
  ExternalLink,
  Loader2,
  Globe
} from 'lucide-react'
import { useStore } from '@store'
import type { FileItem } from '@shared/types'
import { t } from '@renderer/i18n'
import { getDirPath, joinPath, pathEquals, normalizePath } from '@shared/utils/pathUtils'
import { toast } from '../common/ToastProvider'
import { Input, ContextMenu, ContextMenuItem } from '../ui'
import { directoryCacheService } from '@services/directoryCacheService'
import FileIcon from '../common/FileIcon'
import { getFileType } from '../editor/FilePreview'

// 每个节点的高度（像素）
const ITEM_HEIGHT = 30
// 额外渲染的缓冲区节点数
const BUFFER_SIZE = 5

interface FlattenedNode {
  item: FileItem
  depth: number
  isExpanded: boolean
  hasChildren: boolean
}

interface VirtualFileTreeProps {
  items: FileItem[]
  onRefresh: () => void
  creatingIn: { path: string; type: 'file' | 'folder' } | null
  onStartCreate: (path: string, type: 'file' | 'folder') => void
  onCancelCreate: () => void
  onCreateSubmit: (parentPath: string, name: string, type: 'file' | 'folder') => void
}

export const VirtualFileTree = memo(function VirtualFileTree({
  items,
  onRefresh,
  creatingIn,
  onStartCreate,
  onCancelCreate,
  onCreateSubmit
}: VirtualFileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // 子目录缓存
  const [childrenCache, setChildrenCache] = useState<Map<string, FileItem[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  const {
    expandedFolders,
    toggleFolder,
    expandFolder,
    openFile,
    setActiveFile,
    activeFilePath,
    language,
    workspacePath
  } = useStore()

  // 焦点状态
  const [focusedPath, setFocusedPath] = useState<string | null>(null)

  // 定位高亮状态（闪烁动画）
  const [highlightPath, setHighlightPath] = useState<string | null>(null)

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FlattenedNode
  } | null>(null)

  // 重命名状态
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 监听容器尺寸变化
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    setContainerHeight(container.clientHeight)

    return () => observer.disconnect()
  }, [])

  // 加载子目录
  const loadChildren = useCallback(async (path: string) => {
    if (childrenCache.has(path) || loadingDirs.has(path)) return

    setLoadingDirs((prev) => new Set(prev).add(path))
    try {
      const children = await directoryCacheService.getDirectory(path)
      setChildrenCache((prev) => new Map(prev).set(path, children))

      // 预加载下一层
      const subDirs = children.filter((c) => c.isDirectory).slice(0, 3)
      if (subDirs.length > 0) {
        directoryCacheService.preload(subDirs.map((d) => d.path))
      }
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [childrenCache, loadingDirs])

  // 当 items (根目录内容) 变化时，清除子目录缓存以确保一致性
  // 这使得刷新或折叠后重新展开目录时能获取最新内容
  useEffect(() => {
    setChildrenCache(new Map())
    directoryCacheService.clear()
  }, [items])

  // 展开文件夹时加载子目录
  useEffect(() => {
    expandedFolders.forEach((path) => {
      if (!childrenCache.has(path)) {
        loadChildren(path)
      }
    })
  }, [expandedFolders, childrenCache, loadChildren])

  // 滚动到指定文件的状态（使用文件路径作为触发器）
  const [scrollToFile, setScrollToFile] = useState<string | null>(null)

  // 加载目录并返回子项（直接返回，不依赖状态更新）
  const loadDirectoryChildren = useCallback(async (dirPath: string): Promise<FileItem[]> => {
    // 先检查缓存
    const cached = childrenCache.get(dirPath)
    if (cached) return cached

    try {
      const children = await directoryCacheService.getDirectory(dirPath)
      // 更新缓存状态
      setChildrenCache((prev) => new Map(prev).set(dirPath, children))
      return children
    } catch {
      return []
    }
  }, [childrenCache])

  // 展开文件所在的所有父目录
  const revealFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return

    const normalizedFilePath = normalizePath(filePath)
    const normalizedWorkspace = normalizePath(workspacePath)

    // 收集需要展开的目录路径（从工作区根目录开始，到文件的直接父目录）
    const pathsToExpand: string[] = []
    let currentPath = getDirPath(normalizedFilePath)

    while (currentPath && currentPath.length > normalizedWorkspace.length) {
      pathsToExpand.unshift(currentPath)
      const parentPath = getDirPath(currentPath)
      if (parentPath === currentPath) break
      currentPath = parentPath
    }

    // 从根目录的 items 开始，逐级查找并展开
    let currentItems: FileItem[] = items
    const pathsToExpandActual: string[] = []

    for (const normalizedPath of pathsToExpand) {
      // 在当前层级的 items 中查找匹配的目录
      const targetDir = currentItems.find(item =>
        item.isDirectory && pathEquals(item.path, normalizedPath)
      )

      if (targetDir) {
        pathsToExpandActual.push(targetDir.path)

        // 展开该目录
        const isExpanded = expandedFolders.has(targetDir.path)
        if (!isExpanded) {
          expandFolder(targetDir.path)
        }

        // 加载子目录内容（直接获取返回值，不等待状态更新）
        currentItems = await loadDirectoryChildren(targetDir.path)
      } else {
        // 找不到匹配的目录，可能路径格式不一致，尝试直接使用 normalized 路径
        pathsToExpandActual.push(normalizedPath)
        expandFolder(normalizedPath)
        currentItems = await loadDirectoryChildren(normalizedPath)
      }
    }

    setFocusedPath(filePath)
    setScrollToFile(filePath)
  }, [workspacePath, items, expandedFolders, expandFolder, loadDirectoryChildren])

  // 监听 "Reveal in Explorer" 事件
  useEffect(() => {
    const handleReveal = () => {
      if (activeFilePath && workspacePath) {
        revealFile(activeFilePath)
      }
    }
    // 支持定位任意文件（通过 detail.filePath 传入）
    const handleRevealFile = (e: Event) => {
      const customEvent = e as CustomEvent<{ filePath: string }>
      if (customEvent.detail?.filePath && workspacePath) {
        revealFile(customEvent.detail.filePath)
      }
    }
    window.addEventListener('explorer:reveal-active-file', handleReveal)
    window.addEventListener('explorer:reveal-file', handleRevealFile)
    return () => {
      window.removeEventListener('explorer:reveal-active-file', handleReveal)
      window.removeEventListener('explorer:reveal-file', handleRevealFile)
    }
  }, [activeFilePath, workspacePath, revealFile])

  // 扁平化树结构（只包含可见节点）
  const flattenedNodes = useMemo(() => {
    const result: FlattenedNode[] = []

    const sortItems = (items: FileItem[]) => {
      return [...items].sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
        return a.isDirectory ? -1 : 1
      })
    }

    const traverse = (items: FileItem[], depth: number) => {
      for (const item of sortItems(items)) {
        const isExpanded = expandedFolders.has(item.path)
        const children = childrenCache.get(item.path)
        const hasChildren = item.isDirectory

        result.push({ item, depth, isExpanded, hasChildren })

        // 如果是正在创建的目录，添加创建输入框占位
        if (creatingIn?.path === item.path && isExpanded) {
          result.push({
            item: { name: '__creating__', path: `${item.path}/__creating__`, isDirectory: false },
            depth: depth + 1,
            isExpanded: false,
            hasChildren: false
          })
        }

        if (item.isDirectory && isExpanded && children) {
          traverse(children, depth + 1)
        }
      }
    }

    // 根目录创建输入框
    if (creatingIn?.path === workspacePath) {
      result.push({
        item: { name: '__creating__', path: `${workspacePath}/__creating__`, isDirectory: false },
        depth: 0,
        isExpanded: false,
        hasChildren: false
      })
    }

    traverse(items, 0)
    return result
  }, [items, expandedFolders, childrenCache, creatingIn, workspacePath])

  // 处理滚动到目标文件（必须在 flattenedNodes 定义之后）
  useEffect(() => {
    if (!scrollToFile) return

    const index = flattenedNodes.findIndex(node => pathEquals(node.item.path, scrollToFile))

    if (index !== -1 && containerRef.current) {
      const top = index * ITEM_HEIGHT
      containerRef.current.scrollTo({
        top: Math.max(0, top - containerHeight / 2),
        behavior: 'smooth'
      })

      // 触发闪烁高亮动画
      setHighlightPath(scrollToFile)
      setTimeout(() => setHighlightPath(null), 2000)
    }

    setScrollToFile(null)
  }, [scrollToFile, flattenedNodes, containerHeight])

  // 计算可见范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE)
    const endIndex = Math.min(
      flattenedNodes.length,
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_SIZE
    )
    return { startIndex, endIndex }
  }, [scrollTop, containerHeight, flattenedNodes.length])

  // 可见节点
  const visibleNodes = useMemo(() => {
    return flattenedNodes.slice(visibleRange.startIndex, visibleRange.endIndex)
  }, [flattenedNodes, visibleRange])

  // 总高度
  const totalHeight = flattenedNodes.length * ITEM_HEIGHT

  // 滚动处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // 点击节点
  const handleNodeClick = useCallback(async (node: FlattenedNode) => {
    setFocusedPath(node.item.path)

    if (renamingPath === node.item.path) return

    if (node.item.isDirectory) {
      toggleFolder(node.item.path)
      if (!expandedFolders.has(node.item.path)) {
        loadChildren(node.item.path)
      }
    } else {
      // 检查文件类型
      const fileType = getFileType(node.item.path)

      if (fileType === 'image' || fileType === 'binary') {
        // 图片和二进制文件不需要读取内容，直接打开
        openFile(node.item.path, '')
        setActiveFile(node.item.path)
      } else {
        const content = await api.file.read(node.item.path)
        if (content !== null) {
          openFile(node.item.path, content)
          setActiveFile(node.item.path)
        } else {
          // 文件读取失败，可能是二进制文件或权限问题
          toast.warning(t('error.fileNotFound', language, { path: node.item.name }))
        }
      }
    }
  }, [renamingPath, toggleFolder, expandedFolders, loadChildren, openFile, setActiveFile, language])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FlattenedNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.item.name === '__creating__') return
    setFocusedPath(node.item.path)
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  // 菜单操作
  const handleDelete = useCallback(async (node: FlattenedNode) => {
    const { globalConfirm } = await import('@components/common/ConfirmDialog')
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '删除' : 'Delete',
      message: t('confirmDelete', language, { name: node.item.name }),
      variant: 'danger',
    })
    if (confirmed) {
      await api.file.delete(node.item.path)
      directoryCacheService.invalidate(getDirPath(node.item.path))
      setChildrenCache((prev) => {
        const next = new Map(prev)
        next.delete(node.item.path)
        return next
      })
      onRefresh()
    }
  }, [language, onRefresh])

  const handleRenameStart = useCallback((node: FlattenedNode) => {
    setRenamingPath(node.item.path)
    setRenameValue(node.item.name)
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      return
    }

    const node = flattenedNodes.find((n) => n.item.path === renamingPath)
    if (!node || renameValue === node.item.name) {
      setRenamingPath(null)
      return
    }

    const newPath = joinPath(getDirPath(renamingPath), renameValue)
    const success = await api.file.rename(renamingPath, newPath)
    if (success) {
      directoryCacheService.invalidate(getDirPath(renamingPath))
      setChildrenCache((prev) => {
        const next = new Map(prev)
        next.delete(renamingPath)
        return next
      })
      onRefresh()
    }
    setRenamingPath(null)
  }, [renamingPath, renameValue, flattenedNodes, onRefresh])

  // 全局快捷键处理 (F2 重命名)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'F2' && focusedPath && !renamingPath) {
      e.preventDefault()
      const node = flattenedNodes.find(n => pathEquals(n.item.path, focusedPath))
      if (node) {
        handleRenameStart(node)
      }
    }
  }, [focusedPath, renamingPath, flattenedNodes, handleRenameStart])

  const handleCopyPath = useCallback((node: FlattenedNode) => {
    navigator.clipboard.writeText(node.item.path)
    toast.success('Path copied')
  }, [])

  const handleCopyRelativePath = useCallback((node: FlattenedNode) => {
    if (workspacePath) {
      const relativePath = node.item.path.replace(workspacePath, '').replace(/^[\\/]/, '')
      navigator.clipboard.writeText(relativePath)
      toast.success('Path copied')
    }
  }, [workspacePath])

  const handleRevealInExplorer = useCallback((node: FlattenedNode) => {
    api.file.showInFolder(node.item.path)
  }, [])

  const handleOpenInBrowser = useCallback(async (node: FlattenedNode) => {
    const success = await api.file.openInBrowser(node.item.path)
    if (!success) {
      toast.error('Failed to open in browser')
    }
  }, [])

  const handleNewFile = useCallback((node: FlattenedNode) => {
    if (node.item.isDirectory) {
      expandFolder(node.item.path)
      loadChildren(node.item.path)
      onStartCreate(node.item.path, 'file')
    }
  }, [expandFolder, loadChildren, onStartCreate])

  const handleNewFolder = useCallback((node: FlattenedNode) => {
    if (node.item.isDirectory) {
      expandFolder(node.item.path)
      loadChildren(node.item.path)
      onStartCreate(node.item.path, 'folder')
    }
  }, [expandFolder, loadChildren, onStartCreate])

  // 聚焦重命名输入框
  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingPath])

  // 构建右键菜单项
  const getContextMenuItems = useCallback((node: FlattenedNode): ContextMenuItem[] => {
    if (node.item.isDirectory) {
      return [
        { id: 'newFile', label: t('newFile', language), icon: FilePlus, onClick: () => handleNewFile(node) },
        { id: 'newFolder', label: t('newFolder', language), icon: FolderPlus, onClick: () => handleNewFolder(node) },
        { id: 'sep1', label: '', separator: true },
        { id: 'rename', label: t('rename', language), icon: Edit2, onClick: () => handleRenameStart(node) },
        { id: 'delete', label: t('delete', language), icon: Trash2, danger: true, onClick: () => handleDelete(node) },
        { id: 'sep2', label: '', separator: true },
        { id: 'copyPath', label: 'Copy Path', icon: Copy, onClick: () => handleCopyPath(node) },
        { id: 'copyRelPath', label: 'Copy Relative Path', icon: Clipboard, onClick: () => handleCopyRelativePath(node) },
        { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: () => handleRevealInExplorer(node) },
      ]
    }
    const isHtmlFile = node.item.name.toLowerCase().endsWith('.html') ||
      node.item.name.toLowerCase().endsWith('.htm')

    const items: ContextMenuItem[] = [
      { id: 'rename', label: t('rename', language), icon: Edit2, onClick: () => handleRenameStart(node) },
      { id: 'delete', label: t('delete', language), icon: Trash2, danger: true, onClick: () => handleDelete(node) },
      { id: 'sep1', label: '', separator: true },
      { id: 'copyPath', label: 'Copy Path', icon: Copy, onClick: () => handleCopyPath(node) },
      { id: 'copyRelPath', label: 'Copy Relative Path', icon: Clipboard, onClick: () => handleCopyRelativePath(node) },
      { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: () => handleRevealInExplorer(node) },
    ]

    // 对 HTML 文件添加"在浏览器中打开"选项
    if (isHtmlFile) {
      items.push({ id: 'sep2', label: '', separator: true })
      items.push({ id: 'openInBrowser', label: 'Open in Browser', icon: Globe, onClick: () => handleOpenInBrowser(node) })
    }

    return items
  }, [language, handleNewFile, handleNewFolder, handleRenameStart, handleDelete, handleCopyPath, handleCopyRelativePath, handleRevealInExplorer, handleOpenInBrowser])

  // 渲染单个节点
  const renderNode = (node: FlattenedNode, index: number) => {
    const { item, depth, isExpanded } = node
    const isActive = pathEquals(activeFilePath || '', item.path)
    const isFocused = focusedPath ? pathEquals(focusedPath, item.path) && !isActive : false
    const isHighlighted = highlightPath ? pathEquals(highlightPath, item.path) : false
    const isRenaming = renamingPath === item.path
    const isLoading = loadingDirs.has(item.path)
    const isCreatingInput = item.name === '__creating__'

    // 创建输入框
    if (isCreatingInput && creatingIn) {
      return (
        <div
          key={item.path}
          className="flex items-center gap-1.5 py-1 pr-2"
          style={{
            height: ITEM_HEIGHT,
            paddingLeft: `${depth * 12 + 12}px`,
            position: 'absolute',
            top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
            left: 0,
            right: 0
          }}
        >
          <span className="w-3.5 flex-shrink-0" />
          {creatingIn.type === 'folder' ? (
            <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          ) : (
            <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          )}
          <Input
            autoFocus
            placeholder={creatingIn.type === 'file' ? 'filename.ext' : 'folder name'}
            className="flex-1 h-6 text-[13px]"
            onBlur={(e) => {
              if (e.target.value.trim()) {
                onCreateSubmit(creatingIn.path, e.target.value.trim(), creatingIn.type)
              } else {
                onCancelCreate()
              }
            }}
            onKeyDown={(e) => {
              // 输入法组合中不处理回车
              if (e.nativeEvent.isComposing) return

              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                e.preventDefault()
                onCreateSubmit(creatingIn.path, e.currentTarget.value.trim(), creatingIn.type)
              } else if (e.key === 'Escape') {
                onCancelCreate()
              }
            }}
          />
        </div>
      )
    }

    return (
      <div
        key={item.path}
        onClick={() => handleNodeClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData('application/adnify-file-path', item.path)
          e.dataTransfer.setData('text/uri-list', `file:///${item.path.replace(/\\/g, '/')}`)
          e.dataTransfer.setData('text/plain', item.path)
          // 设置拖动时的图标
          const dragImage = document.createElement('div')
          dragImage.textContent = item.name
          dragImage.style.cssText = 'position: absolute; top: -1000px; padding: 4px 8px; background: var(--surface); border-radius: 4px; font-size: 12px; color: var(--text-primary);'
          document.body.appendChild(dragImage)
          e.dataTransfer.setDragImage(dragImage, 0, 0)
          setTimeout(() => document.body.removeChild(dragImage), 0)
        }}
        className={`
          group flex items-center gap-2 pr-2 cursor-pointer transition-all duration-150 relative select-none rounded-md mx-2 my-0
          ${isActive
            ? 'bg-accent/15 text-text-primary font-medium'
            : isFocused
              ? 'bg-surface-hover border border-accent/30 text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }
          ${isHighlighted ? 'animate-reveal-highlight' : ''}
        `}
        style={{
          height: ITEM_HEIGHT,
          paddingLeft: `${depth * 12 + 8}px`,
          position: 'absolute',
          top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
          left: 0,
          right: 0
        }}
      >
        {/* Active Indicator - Premium Glow */}
        {isActive && (
          <div className="absolute left-[-8px] top-[6px] bottom-[6px] w-[3px] bg-accent rounded-r-full shadow-[0_0_12px_rgba(var(--accent),0.6)] z-10" />
        )}

        {/* Indent Guide - Very subtle line */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/20 group-hover:border-border/40 transition-colors"
            style={{ left: `${(i + 1) * 12}px` }}
          />
        ))}

        {/* Icon & Toggle */}
        {item.isDirectory ? (
          <>
            <div className="flex items-center justify-center w-4 h-4 -ml-1 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted opacity-40 group-hover:opacity-100" />
            </div>
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
            ) : (
              <FileIcon filename={item.name} isDirectory isOpen={isExpanded} size={16} className="flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <div className="w-3 flex-shrink-0" />
            <FileIcon filename={item.name} size={16} className="flex-shrink-0" />
          </>
        )}

        {/* Name */}
        {isRenaming ? (
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              // 输入法组合中不处理回车
              if (e.nativeEvent.isComposing) return

              if (e.key === 'Enter') {
                e.preventDefault()
                handleRenameSubmit()
              }
              if (e.key === 'Escape') setRenamingPath(null)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-5 text-[13px] px-1 py-0"
            autoFocus
          />
        ) : (
          <span className="text-[13px] truncate leading-normal flex-1 opacity-90 group-hover:opacity-100">
            {item.name}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar focus:outline-none"
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onBlur={() => {
        // Only clear focus if not renaming and not opening context menu
        if (!renamingPath && !contextMenu) {
          setFocusedPath(null)
        }
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleNodes.map((node, index) => renderNode(node, index))}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})
