/**
 * Plan 模式的 Agent 工具
 * 
 * 提供创建和管理工作流的工具
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { Workflow } from '../types/workflow'

/**
 * 创建工作流文件
 * 
 * 这个工具会创建：
 * 1. 工作流 JSON 文件：.adnify/workflows/{name}.json
 * 2. 需求文档：.adnify/workflows/{name}.md
 * 
 * @param name 工作流名称
 * @param description 工作流描述
 * @param requirements 需求文档（Markdown 格式）
 * @param workflowDef 工作流定义（包含 nodes 和 edges）
 * @param workspacePath 工作区路径
 */
export async function createWorkflowFile(
  name: string,
  description: string,
  requirements: string,
  workflowDef: { nodes: Workflow['nodes']; edges: Workflow['edges'] },
  workspacePath: string | null
): Promise<{ success: boolean; workflowPath?: string; requirementsPath?: string; error?: string }> {
  try {
    if (!workspacePath) {
      return { success: false, error: 'No workspace open' }
    }

    // 验证工作流定义
    if (!workflowDef.nodes || !Array.isArray(workflowDef.nodes) || workflowDef.nodes.length < 2) {
      return { success: false, error: 'Workflow must have at least start and end nodes' }
    }

    if (!workflowDef.edges || !Array.isArray(workflowDef.edges)) {
      return { success: false, error: 'Workflow must have edges connecting nodes' }
    }

    // 创建 .adnify/workflows 目录
    const workflowsDir = `${workspacePath}/.adnify/workflows`
    await api.file.ensureDir(workflowsDir)

    // 生成文件名
    const fileName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const workflowPath = `${workflowsDir}/${fileName}.json`
    const requirementsPath = `${workflowsDir}/${fileName}.md`

    // 创建工作流
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      name,
      description,
      version: '1.0.0',
      nodes: workflowDef.nodes.map(node => ({
        ...node,
        status: 'pending' as const,
      })),
      edges: workflowDef.edges,
      config: {
        maxRetries: 3,
        timeout: 60000,
        continueOnError: false,
        variables: {},
        environment: 'development',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // 写入工作流文件
    const workflowContent = JSON.stringify(workflow, null, 2)
    await api.file.write(workflowPath, workflowContent)

    // 写入需求文档
    const requirementsContent = `# ${name}

## 描述

${description}

## 需求文档

${requirements}

---

*创建时间: ${new Date().toLocaleString()}*
*工作流文件: ${fileName}.json*
`
    await api.file.write(requirementsPath, requirementsContent)

    logger.plan.info('[AgentTools] Created workflow and requirements:', workflowPath, requirementsPath)

    return { 
      success: true, 
      workflowPath,
      requirementsPath,
    }
  } catch (error) {
    logger.plan.error('[AgentTools] Failed to create workflow:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 更新工作流文件
 */
export async function updateWorkflowFile(
  filePath: string,
  updates: Partial<Workflow>
): Promise<{ success: boolean; error?: string }> {
  try {
    // 读取现有工作流
    const content = await api.file.read(filePath)
    if (!content) {
      return { success: false, error: 'File not found' }
    }

    const workflow: Workflow = JSON.parse(content)

    // 应用更新
    const updated: Workflow = {
      ...workflow,
      ...updates,
      updatedAt: Date.now(),
    }

    // 写回文件
    const newContent = JSON.stringify(updated, null, 2)
    await api.file.write(filePath, newContent)

    logger.plan.info('[AgentTools] Updated workflow file:', filePath)

    return { success: true }
  } catch (error) {
    logger.plan.error('[AgentTools] Failed to update workflow:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 列出所有工作流文件
 */
export async function listWorkflowFiles(
  workspacePath: string | null
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  try {
    if (!workspacePath) {
      return { success: false, error: 'No workspace open' }
    }

    const workflowsDir = `${workspacePath}/.adnify/workflows`
    const files = await api.file.readDir(workflowsDir)

    if (!files) {
      return { success: true, files: [] }
    }

    // 只返回 .json 文件
    const jsonFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => `${workflowsDir}/${f}`)

    return { success: true, files: jsonFiles }
  } catch (error) {
    logger.plan.error('[AgentTools] Failed to list workflows:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
