/**
 * 虚拟化文件树组件
 * 只渲染可见区域的节点，提升大目录性能
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  Edit2,
  Trash2,
  Copy,
  Clipboard,
  ExternalLink
} from 'lucide-react'
import { useStore } from '@store'
import { FileItem } from '@app-types/electron'
import { t } from '@renderer/i18n'
import { getDirPath, joinPath } from '@utils/pathUtils'
import { toast } from '../common/ToastProvider'
import { Input, ContextMenu, ContextMenuItem } from '../ui'
import { directoryCacheService } from '@services/directoryCacheService'
import { keybindingService } from '@services/keybindingService'
import FileIcon from '../common/FileIcon'

// 每个节点的高度（像素）
const ITEM_HEIGHT = 28
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

export function VirtualFileTree({
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

  const shouldScrollRef = useRef(false)

  // 监听 activeFilePath 变化，自动展开
  useEffect(() => {
    if (!activeFilePath || !workspacePath) return

    const syncFile = async () => {
      // 1. 确保所有父目录都已展开并加载
      let currentPath = getDirPath(activeFilePath)
      const pathsToExpand: string[] = []

      while (currentPath && currentPath.length >= workspacePath.length) {
        if (currentPath === workspacePath) break
        pathsToExpand.unshift(currentPath)
        currentPath = getDirPath(currentPath)
      }

      // 逐级展开并加载
      for (const path of pathsToExpand) {
        if (!expandedFolders.has(path)) {
          expandFolder(path)
          await loadChildren(path)
        }
      }

      // 标记需要滚动
      shouldScrollRef.current = true
    }

    syncFile()
  }, [activeFilePath, workspacePath, expandedFolders, loadChildren, expandFolder])

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

  // 处理滚动
  useEffect(() => {
    if (shouldScrollRef.current && activeFilePath) {
      const index = flattenedNodes.findIndex(node => node.item.path === activeFilePath)
      if (index !== -1 && containerRef.current) {
        const top = index * ITEM_HEIGHT
        // 如果不在可见范围内，则滚动
        if (top < scrollTop || top > scrollTop + containerHeight - ITEM_HEIGHT) {
          containerRef.current.scrollTo({
            top: Math.max(0, top - containerHeight / 2), // 滚动到中间
            behavior: 'smooth'
          })
        }
        shouldScrollRef.current = false
      }
    }
  }, [flattenedNodes, activeFilePath, scrollTop, containerHeight])

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
    if (renamingPath === node.item.path) return

    if (node.item.isDirectory) {
      toggleFolder(node.item.path)
      if (!expandedFolders.has(node.item.path)) {
        loadChildren(node.item.path)
      }
    } else {
      const content = await window.electronAPI.readFile(node.item.path)
      if (content !== null) {
        openFile(node.item.path, content)
        setActiveFile(node.item.path)
      } else {
        // 文件读取失败，可能是二进制文件或权限问题
        // 尝试用空内容打开，让编辑器显示
        toast.warning(t('error.fileNotFound', language, { path: node.item.name }))
      }
    }
  }, [renamingPath, toggleFolder, expandedFolders, loadChildren, openFile, setActiveFile, language])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FlattenedNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.item.name === '__creating__') return
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  // 菜单操作
  const handleDelete = useCallback(async (node: FlattenedNode) => {
    if (confirm(t('confirmDelete', language, { name: node.item.name }))) {
      await window.electronAPI.deleteFile(node.item.path)
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
    const success = await window.electronAPI.renameFile(renamingPath, newPath)
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
    window.electronAPI.showItemInFolder(node.item.path)
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
    return [
      { id: 'rename', label: t('rename', language), icon: Edit2, onClick: () => handleRenameStart(node) },
      { id: 'delete', label: t('delete', language), icon: Trash2, danger: true, onClick: () => handleDelete(node) },
      { id: 'sep1', label: '', separator: true },
      { id: 'copyPath', label: 'Copy Path', icon: Copy, onClick: () => handleCopyPath(node) },
      { id: 'copyRelPath', label: 'Copy Relative Path', icon: Clipboard, onClick: () => handleCopyRelativePath(node) },
      { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: () => handleRevealInExplorer(node) },
    ]
  }, [language, handleNewFile, handleNewFolder, handleRenameStart, handleDelete, handleCopyPath, handleCopyRelativePath, handleRevealInExplorer])

  // 渲染单个节点
  const renderNode = (node: FlattenedNode, index: number) => {
    const { item, depth, isExpanded } = node
    const isActive = activeFilePath === item.path
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
              if (keybindingService.matches(e, 'list.select') && e.currentTarget.value.trim()) {
                onCreateSubmit(creatingIn.path, e.currentTarget.value.trim(), creatingIn.type)
              } else if (keybindingService.matches(e, 'list.cancel')) {
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
        className={`
          group flex items-center gap-1.5 pr-2 cursor-pointer transition-all duration-200 relative select-none
          ${isActive ? 'bg-accent/10 text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}
        `}
        style={{
          height: ITEM_HEIGHT,
          paddingLeft: `${depth * 12 + 12}px`,
          position: 'absolute',
          top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
          left: 0,
          right: 0
        }}
      >
        {/* Active Indicator */}
        {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />}

        {/* Indent Guide */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-border-subtle group-hover:border-white/10"
            style={{ left: `${depth * 12}px` }}
          />
        )}

        {/* Icon */}
        {item.isDirectory ? (
          <>
            <span className={`transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
              <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
            </span>
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-text-muted border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : (
              <FileIcon filename={item.name} isDirectory isOpen={isExpanded} size={16} />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 flex-shrink-0" />
            <FileIcon filename={item.name} size={16} />
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
              if (keybindingService.matches(e, 'list.select')) handleRenameSubmit()
              if (keybindingService.matches(e, 'list.cancel')) setRenamingPath(null)
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
      className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar"
      onScroll={handleScroll}
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
}
