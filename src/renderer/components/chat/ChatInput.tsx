/**
 * 聊天输入组件
 * 极致打磨：悬浮光晕、灵动按钮、精致上下文药丸
 */
import { useRef, useCallback, useMemo, useState } from 'react'
import {
  FileText,
  X,
  Code,
  GitBranch,
  Terminal,
  Database,
  Paperclip,
  ArrowUp,
  Plus,
  Folder,
  Globe,
  Image as ImageIcon
} from 'lucide-react'
import { useStore } from '@store'
import { WorkMode } from '@/renderer/modes/types'
import { t } from '@renderer/i18n'
import { Button } from '../ui'
import ModelSelector from './ModelSelector'
import ModeSelector from './ModeSelector'

import { ContextItem, FileContext } from '@/renderer/agent/types'

export interface PendingImage {
  id: string
  file: File
  previewUrl: string
  base64?: string
}

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  images: PendingImage[]
  setImages: React.Dispatch<React.SetStateAction<PendingImage[]>>
  isStreaming: boolean
  hasApiKey: boolean
  hasPendingToolCall: boolean
  chatMode: WorkMode
  setChatMode: (mode: WorkMode) => void
  onSubmit: () => void
  onAbort: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
  inputContainerRef: React.RefObject<HTMLDivElement>
  contextItems: ContextItem[]
  onRemoveContextItem: (item: ContextItem) => void
  activeFilePath?: string | null
  onAddFile?: (filePath: string) => void
}

export default function ChatInput({
  input,
  images,
  setImages,
  isStreaming,
  hasApiKey,
  hasPendingToolCall,
  chatMode,
  setChatMode,
  onSubmit,
  onAbort,
  onInputChange,
  onKeyDown,
  onPaste,
  textareaRef,
  inputContainerRef,
  contextItems,
  onRemoveContextItem,
  activeFilePath,
  onAddFile,
}: ChatInputProps) {
  const { language, editorConfig } = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)

  // 文件引用检测
  const fileRefs = useMemo(() => {
    const refs: string[] = []
    const regex = /@(?:file:)?([^\s@]+\.[a-zA-Z0-9]+)/g
    let match
    while ((match = regex.exec(input)) !== null) {
      if (match[1] !== 'codebase') {
        refs.push(match[1])
      }
    }
    return refs
  }, [input])

  // 特殊上下文引用检测
  const hasCodebaseRef = useMemo(() => /@codebase\b/i.test(input), [input])
  const hasSymbolsRef = useMemo(() => /@symbols\b/i.test(input), [input])
  const hasGitRef = useMemo(() => /@git\b/i.test(input), [input])
  const hasTerminalRef = useMemo(() => /@terminal\b/i.test(input), [input])
  const hasWebRef = useMemo(() => /@web\b/i.test(input), [input])

  // 添加图片
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages((prev) => [...prev, { id, file, previewUrl }])
  }, [setImages])

  // 移除图片
  const removeImage = useCallback(
    (id: string) => {
      setImages((prev) => prev.filter((img) => img.id !== id))
    },
    [setImages]
  )

  const isSendable = input.trim().length > 0 || images.length > 0

  return (
    <div ref={inputContainerRef} className="p-4 z-20">
      <div
        className={`
            relative group flex flex-col rounded-3xl transition-all duration-300 ease-out border backdrop-blur-xl
            ${isStreaming
            ? 'bg-surface/80 border-accent/30 ring-1 ring-accent/20'
            : isFocused
              ? 'bg-background/90 border-accent/40 ring-1 ring-accent/10 shadow-2xl shadow-accent/5 translate-y-[-1px]'
              : 'bg-surface/40 border-border hover:border-accent/20 shadow-xl shadow-black/20'
          }
        `}
      >
        {/* Image Previews */}
        {images.length > 0 && (
          <div className="flex gap-3 px-4 pt-4 overflow-x-auto custom-scrollbar">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative group/img flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-border shadow-sm"
              >
                <img src={img.previewUrl} alt="preview" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute top-1 right-1 p-1 bg-black/60 backdrop-blur rounded-full text-white hover:bg-red-500 transition-all opacity-0 group-hover/img:opacity-100 scale-90 hover:scale-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Context Chips */}
        {(contextItems.length > 0 || fileRefs.length > 0 || hasCodebaseRef || hasSymbolsRef || hasGitRef || hasTerminalRef || hasWebRef || (activeFilePath && onAddFile)) && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {/* Active File Suggestion */}
            {activeFilePath && onAddFile && !contextItems.some(item => item.type === 'File' && (item as FileContext).uri === activeFilePath) && (
              <button
                onClick={() => onAddFile(activeFilePath)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/5 text-accent text-[11px] font-bold rounded-full border border-accent/10 animate-fade-in select-none hover:bg-accent/15 transition-colors hover:border-accent/30"
              >
                <Plus className="w-3 h-3" strokeWidth={3} />
                <span>{activeFilePath.split(/[/\\]/).pop()}</span>
              </button>
            )}
            {/* Context Items */}
            {contextItems.filter(item => ['File', 'Folder', 'CodeSelection'].includes(item.type)).map((item, i) => {
              const getContextStyle = (type: string) => {
                switch (type) {
                  case 'File': return { bg: 'bg-surface/50', text: 'text-text-secondary', border: 'border-border', Icon: FileText }
                  case 'CodeSelection': return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', Icon: Code }
                  case 'Folder': return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20', Icon: Folder }
                  default: return { bg: 'bg-surface/50', text: 'text-text-muted', border: 'border-border', Icon: FileText }
                }
              }

              const style = getContextStyle(item.type)
              const label = (() => {
                switch (item.type) {
                  case 'File':
                  case 'Folder': {
                    const uri = (item as any).uri || ''
                    return uri.split(/[/\\]/).pop() || uri
                  }
                  case 'CodeSelection': {
                    const uri = (item as any).uri || ''
                    const range = (item as any).range as [number, number] | undefined
                    const name = uri.split(/[/\\]/).pop() || uri
                    return range ? `${name}:${range[0]}-${range[1]}` : name
                  }
                  default: return 'Context'
                }
              })()

              return (
                <span
                  key={`ctx-${i}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${style.bg} ${style.text} text-[11px] font-medium rounded-full border ${style.border} animate-fade-in select-none group/chip transition-all hover:border-opacity-100 hover:shadow-sm`}
                >
                  <style.Icon className="w-3 h-3 opacity-70" />
                  <span className="max-w-[120px] truncate">{label}</span>
                  <button
                    onClick={() => onRemoveContextItem(item)}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/20 text-current hover:text-red-400 opacity-60 group-hover/chip:opacity-100 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )
            })}

            {/* Other Reference Chips */}
            {hasCodebaseRef && <ContextChip icon={Database} label="@codebase" color="green" />}
            {hasSymbolsRef && <ContextChip icon={Code} label="@symbols" color="pink" />}
            {hasGitRef && <ContextChip icon={GitBranch} label="@git" color="orange" />}
            {hasTerminalRef && <ContextChip icon={Terminal} label="@terminal" color="cyan" />}
            {hasWebRef && <ContextChip icon={Globe} label="@web" color="blue" />}
          </div>
        )}

        {/* Input Area */}
        <div className="flex items-end gap-3 px-4 pb-3 pt-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={hasApiKey ? t('pasteImagesHint', language) : t('configureApiKey', language)}
            disabled={!hasApiKey || hasPendingToolCall}
            className="flex-1 bg-transparent border-none p-0 py-2.5
                       text-[15px] text-text-primary placeholder-text-muted/40 resize-none
                       focus:ring-0 focus:outline-none leading-relaxed custom-scrollbar max-h-[200px] caret-accent font-medium tracking-wide"
            rows={1}
            style={{ minHeight: '48px', fontSize: `${Math.max(14, editorConfig.fontSize)}px` }}
          />

          <div className="flex items-center gap-2 pb-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  Array.from(e.target.files).forEach(addImage)
                }
                e.target.value = ''
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              title={t('uploadImage', language)}
              className="rounded-xl w-8 h-8 hover:bg-surface-active text-text-muted hover:text-text-primary transition-all active:scale-95"
            >
              <ImageIcon className="w-4 h-4 opacity-70 group-hover:opacity-100" />
            </Button>

            <button
              onClick={isStreaming ? onAbort : onSubmit}
              disabled={
                !hasApiKey || ((!input.trim() && images.length === 0) && !isStreaming) || hasPendingToolCall
              }
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)
                  ${isStreaming
                  ? 'bg-surface/50 text-text-primary border border-white/10 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20'
                  : isSendable
                    ? 'bg-accent text-white shadow-lg shadow-accent/30 hover:shadow-accent/50 hover:scale-105 active:scale-95 border border-white/10'
                    : 'bg-white/5 text-text-muted/30 cursor-not-allowed border border-transparent'
                }
                  `}
            >
              {isStreaming ? (
                <div className="w-2.5 h-2.5 bg-current rounded-[1px] animate-pulse" />
              ) : (
                <ArrowUp className="w-5 h-5 stroke-[3]" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mode & Model Selector */}
      <div className="mt-3 flex items-center justify-between px-3">
        <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
          <ModeSelector mode={chatMode} onModeChange={setChatMode} />
          <ModelSelector />
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[10px] text-text-muted/40 font-medium tracking-wide whitespace-nowrap overflow-hidden shrink-0">
          <span>⏎ Send</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-30" />
          <span>⇧⏎ New Line</span>
        </div>
      </div>
    </div>
  )
}

// 辅助组件：上下文 Chip
function ContextChip({ icon: Icon, label, color }: { icon: any, label: string, color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    pink: 'text-pink-400 bg-pink-400/10 border-pink-400/20',
    orange: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
    cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  }
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${colorMap[color]} text-[11px] font-bold rounded-full border animate-fade-in select-none`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}