/**
 * 任务列表面板
 * 显示 Agent 拆解的子任务及其进度
 */

import { useState, memo } from 'react'
import { Check, Circle, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TodoItem } from '@/renderer/agent/types'

interface TodoListPanelProps {
  todos: TodoItem[]
  /** 插入到 header 左侧的额外内容（如切换图标） */
  headerPrefix?: React.ReactNode
}

const StatusIcon = memo(({ status }: { status: TodoItem['status'] }) => {
  switch (status) {
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
    case 'in_progress':
      return <div className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0 mx-[3px]" />
    case 'pending':
      return <Circle className="w-3.5 h-3.5 text-text-muted/40 flex-shrink-0" />
  }
})
StatusIcon.displayName = 'StatusIcon'

const TodoRow = memo(({ todo }: { todo: TodoItem }) => {
  const isCompleted = todo.status === 'completed'
  const isActive = todo.status === 'in_progress'

  return (
    <div className={`flex items-start gap-2 py-1 px-1 rounded-md transition-colors
      ${isActive ? 'bg-accent/5' : ''}`}
    >
      <div className="mt-0.5">
        <StatusIcon status={todo.status} />
      </div>
      <span className={`text-[11px] leading-relaxed
        ${isCompleted ? 'text-text-muted/60 line-through' : ''}
        ${isActive ? 'text-text-primary font-medium' : ''}
        ${todo.status === 'pending' ? 'text-text-muted' : ''}
      `}>
        {isActive ? todo.activeForm : todo.content}
      </span>
    </div>
  )
})
TodoRow.displayName = 'TodoRow'

export const TodoListPanel = memo(({ todos, headerPrefix }: TodoListPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(true)

  if (todos.length === 0) return null

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const progress = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="rounded-xl border border-border/50 bg-surface/40 backdrop-blur-md overflow-hidden shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] transition-all">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-hover/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {headerPrefix}
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          <span className="text-[11px] font-medium text-text-primary">
            {completed === total && total > 0 ? (
              <span className="text-green-400">All tasks completed</span>
            ) : (
              <>{completed}/{total} Tasks</>
            )}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-20 h-1 rounded-full bg-border/50 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </button>

      {/* Task list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-0.5 max-h-[200px] overflow-y-auto space-y-0.5">
              {todos.map((todo, i) => (
                <TodoRow key={i} todo={todo} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
TodoListPanel.displayName = 'TodoListPanel'
