/**
 * 工作流预览组件
 * 
 * 在编辑器中预览 .json 格式的工作流文件
 * 支持显示需求文档、执行工作流
 */

import { useState, useEffect } from 'react'
import { Play, Pause, Square, FileText } from 'lucide-react'
import { PlanEngine } from '@/renderer/plan/core/PlanEngine'
import type { Workflow } from '@/renderer/plan/types/workflow'
import { api } from '@/renderer/services/electronAPI'
import { MarkdownPreview } from './FilePreview'

interface WorkflowPreviewProps {
  content: string
}

export function WorkflowPreview({ content }: WorkflowPreviewProps) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<PlanEngine | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [requirements, setRequirements] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'workflow' | 'requirements'>('workflow')

  // 解析工作流
  useEffect(() => {
    try {
      const parsed = JSON.parse(content)
      setWorkflow(parsed)
      setError(null)
      
      // 加载需求文档
      if (parsed.metadata?.requirementsPath) {
        loadRequirements(parsed.metadata.requirementsPath)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON')
      setWorkflow(null)
    }
  }, [content])

  // 加载需求文档
  const loadRequirements = async (path: string) => {
    try {
      const content = await api.file.read(path)
      if (content) {
        setRequirements(content)
      }
    } catch (err) {
      console.error('Failed to load requirements:', err)
    }
  }

  // 创建引擎
  useEffect(() => {
    if (!workflow) {
      setEngine(null)
      setLogs([])
      return
    }

    const newEngine = new PlanEngine(workflow)
    
    // 监听所有事件
    const unsubscribe = newEngine.on('*', (event) => {
      setLogs(prev => [...prev, `[${event.type}] ${event.nodeId || 'workflow'}`])
    })

    setEngine(newEngine)
    
    // 清理
    return () => {
      unsubscribe()
    }
  }, [workflow])

  const handleRun = async () => {
    if (!engine || isRunning) return
    
    setIsRunning(true)
    setLogs([])
    
    try {
      await engine.start()
    } catch (err) {
      setLogs(prev => [...prev, `[ERROR] ${err}`])
    } finally {
      setIsRunning(false)
    }
  }

  const handlePause = () => {
    if (!engine) return
    engine.pause()
    setIsRunning(false)
  }

  const handleStop = () => {
    if (!engine) return
    engine.cancel()
    setIsRunning(false)
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-red-500 text-lg mb-2">Invalid Workflow</div>
          <div className="text-sm text-text-muted">{error}</div>
        </div>
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-text-muted">Loading workflow...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 头部 */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{workflow.name}</h2>
            {workflow.description && (
              <p className="text-sm text-text-muted">{workflow.description}</p>
            )}
          </div>
          
          {/* 控制按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 text-sm"
            >
              <Play className="w-4 h-4" />
              Run
            </button>
            <button
              onClick={handlePause}
              disabled={!isRunning}
              className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 text-sm"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 text-sm"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          </div>
        </div>
        
        {/* 统计信息和标签页 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-text-muted">
            <span>{workflow.nodes?.length || 0} nodes</span>
            <span>{workflow.edges?.length || 0} edges</span>
            <span>v{workflow.version}</span>
          </div>
          
          {/* 标签页切换 */}
          {requirements && (
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
              <button
                onClick={() => setActiveTab('workflow')}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === 'workflow'
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Workflow
              </button>
              <button
                onClick={() => setActiveTab('requirements')}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  activeTab === 'requirements'
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <FileText className="w-3 h-3" />
                Requirements
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      {activeTab === 'workflow' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：节点列表 */}
          <div className="w-1/3 border-r border-border overflow-auto p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Nodes</h3>
            <div className="space-y-2">
              {workflow.nodes?.map(node => (
                <div
                  key={node.id}
                  className="p-3 rounded-lg border border-border bg-surface hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-text-primary">{node.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent">
                      {node.type}
                    </span>
                  </div>
                  {node.status && (
                    <div className="text-xs text-text-muted">
                      Status: {node.status}
                    </div>
                  )}
                </div>
              )) || <div className="text-sm text-text-muted">No nodes</div>}
            </div>
          </div>

          {/* 右侧：日志 */}
          <div className="flex-1 overflow-auto p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Execution Logs</h3>
            {logs.length === 0 ? (
              <div className="text-sm text-text-muted">No logs yet. Click "Run" to start.</div>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, i) => (
                  <div key={i} className="text-text-muted">{log}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {requirements ? (
            <MarkdownPreview content={requirements} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-text-muted">Loading requirements...</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
