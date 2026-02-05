/**
 * 模式选择器组件
 * 下拉方式选择 Chat/Agent 模式
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, MessageSquare, Sparkles, Workflow } from 'lucide-react'
import { WorkMode } from '@/renderer/modes/types'
import { useStore } from '@store'

interface ModeSelectorProps {
  mode: WorkMode
  onModeChange: (mode: WorkMode) => void
  className?: string
}

const MODES: Array<{
  id: WorkMode
  icon: typeof MessageSquare
  labelKey: string
  descZh: string
  descEn: string
  color: string
}> = [
    {
      id: 'chat',
      icon: MessageSquare,
      labelKey: 'Chat',
      descZh: '普通对话，不执行工具',
      descEn: 'Chat only, no tool execution',
      color: 'text-blue-400',
    },
    {
      id: 'agent',
      icon: Sparkles,
      labelKey: 'Agent',
      descZh: 'AI 代理，可执行工具',
      descEn: 'AI agent with tool execution',
      color: 'text-accent',
    },
    {
      id: 'orchestrator',
      icon: Workflow,
      labelKey: 'Orchestrator',
      descZh: '多轮需求收集与任务规划',
      descEn: 'Requirement gathering & task planning',
      color: 'text-purple-400',
    },
  ]

export default function ModeSelector({ mode, onModeChange, className = '' }: ModeSelectorProps) {
  const { language } = useStore()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0]
  const Icon = currentMode.icon

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border
          transition-all duration-200
          ${isOpen
            ? 'bg-surface text-text-primary border-accent/30 shadow-[0_0_0_2px_rgba(var(--accent)/0.1)]'
            : 'bg-surface/50 border-border text-text-secondary hover:text-text-primary hover:bg-surface hover:border-border-active'
          }
        `}
      >
        <Icon className={`w-3.5 h-3.5 ${currentMode.color}`} />
        <span>{currentMode.labelKey}</span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
          {MODES.map((m) => {
            const ModeIcon = m.icon
            const isSelected = mode === m.id
            return (
              <button
                key={m.id}
                onClick={() => {
                  onModeChange(m.id)
                  setIsOpen(false)
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 text-left
                  transition-colors
                  ${isSelected
                    ? 'bg-accent/10'
                    : 'hover:bg-surface-hover'
                  }
                `}
              >
                <ModeIcon className={`w-4 h-4 ${m.color}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                    {m.labelKey}
                  </div>
                  <div className="text-[10px] text-text-muted truncate opacity-80">
                    {language === 'zh' ? m.descZh : m.descEn}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
