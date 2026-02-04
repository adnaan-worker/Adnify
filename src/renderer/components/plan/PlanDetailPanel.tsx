/**
 * PlanDetailPanel - 计划详情面板
 * 
 * 显示选中卡片的详情和内嵌对话
 */

import { useStore } from '@store'
import { X, Send, Settings, Play } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AgentConfigModal } from './AgentConfigModal'

export function PlanDetailPanel() {
    const { planCards, selectedCardId, selectPlanCard, updatePlanCard, language } = useStore()
    const [inputValue, setInputValue] = useState('')
    const [showConfig, setShowConfig] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const selectedCard = selectedCardId
        ? planCards.find(c => c.id === selectedCardId)
        : null

    const handleClose = () => {
        selectPlanCard(null)
    }

    const handleSend = () => {
        if (!inputValue.trim() || !selectedCard) return
        // TODO: Implement actual message sending with agent
        setInputValue('')
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    useEffect(() => {
        if (selectedCard && inputRef.current) {
            inputRef.current.focus()
        }
    }, [selectedCard])

    return (
        <AnimatePresence>
            {selectedCard && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 280, opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="flex-shrink-0 border-t border-border bg-surface/50 overflow-hidden"
                >
                    <div className="h-full flex flex-col">
                        {/* Header */}
                        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                            <div className="flex items-center gap-3">
                                <h3 className="text-sm font-medium text-text-primary">
                                    {selectedCard.name}
                                </h3>
                                <span className="px-2 py-0.5 text-xs rounded-full bg-accent/20 text-accent">
                                    {selectedCard.agentConfig.model}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowConfig(true)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                                    title={language === 'zh' ? '配置智能体' : 'Configure Agent'}
                                >
                                    <Settings className="w-4 h-4" />
                                </button>
                                <button
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-accent transition-colors"
                                    title={language === 'zh' ? '运行' : 'Run'}
                                >
                                    <Play className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {selectedCard.messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm">
                                    <p>
                                        {language === 'zh'
                                            ? '开始与智能体对话，规划你的任务'
                                            : 'Start a conversation to plan your task'}
                                    </p>
                                </div>
                            ) : (
                                selectedCard.messages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${msg.role === 'user'
                                                ? 'bg-accent text-white'
                                                : 'bg-white/10 text-text-primary'
                                                }`}
                                        >                                            {'content' in msg && typeof msg.content === 'string' ? msg.content : '[Complex Content]'}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Input Area */}
                        <div className="flex-shrink-0 p-3 border-t border-border">
                            <div className="flex items-end gap-2">
                                <textarea
                                    ref={inputRef}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={
                                        language === 'zh'
                                            ? '描述你的任务需求...'
                                            : 'Describe your task...'
                                    }
                                    rows={1}
                                    className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim()}
                                    className="p-2 rounded-lg bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Config Modal */}
                    {showConfig && (
                        <AgentConfigModal
                            mode="edit"
                            defaultName={selectedCard.name}
                            defaultConfig={selectedCard.agentConfig}
                            onConfirm={(name, config) => {
                                updatePlanCard(selectedCard.id, { name, agentConfig: config })
                                setShowConfig(false)
                            }}
                            onClose={() => setShowConfig(false)}
                        />
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    )
}
