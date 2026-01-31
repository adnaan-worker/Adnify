/**
 * 工作流模板库
 * 
 * 提供常见任务的预定义工作流模板
 */

import type { WorkflowTemplate } from '../types/workflow'

// ===== 功能开发模板 =====

export const featureDevelopmentTemplate: WorkflowTemplate = {
  id: 'feature-development',
  name: '功能开发',
  description: '完整的功能开发流程，从需求分析到测试验证',
  category: 'development',
  tags: ['feature', 'development', 'full-cycle'],
  workflow: {
    name: '功能开发',
    description: '新功能开发完整流程',
    version: '1.0.0',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: '开始',
        config: {},
        position: { x: 100, y: 50 },
      },
      {
        id: 'ask-requirements',
        type: 'ask',
        label: '需求分析',
        description: '收集功能需求和用户故事',
        config: {
          question: '请描述要开发的功能需求',
          type: 'textarea',
          outputVariable: 'requirements',
        },
        position: { x: 100, y: 150 },
      },
      {
        id: 'generate-design',
        type: 'llm',
        label: '生成技术方案',
        description: '基于需求生成技术设计方案',
        config: {
          prompt: '基于以下需求生成技术方案：\n\n${variables.requirements}\n\n请包含：\n1. 架构设计\n2. 技术选型\n3. 接口设计\n4. 数据模型',
          outputVariable: 'design',
        },
        position: { x: 100, y: 250 },
      },
      {
        id: 'confirm-design',
        type: 'ask',
        label: '确认方案',
        description: '用户确认技术方案',
        config: {
          question: '请确认技术方案是否可行',
          type: 'confirm',
          outputVariable: 'designApproved',
        },
        position: { x: 100, y: 350 },
      },
      {
        id: 'check-approval',
        type: 'decision',
        label: '方案是否通过？',
        config: {
          condition: 'userInputs.designApproved === true',
          trueNext: 'create-structure',
          falseNext: 'generate-design',
        },
        position: { x: 100, y: 450 },
      },
      {
        id: 'create-structure',
        type: 'tool',
        label: '创建文件结构',
        description: '创建项目文件和目录结构',
        config: {
          toolName: 'create_file_or_folder',
          arguments: {
            path: '${variables.projectPath}',
            type: 'folder',
          },
        },
        position: { x: 100, y: 550 },
      },
      {
        id: 'parallel-dev',
        type: 'parallel',
        label: '并行开发',
        description: '同时进行前后端开发',
        config: {
          tasks: [
            { id: 'backend', label: '后端开发', nodeId: 'backend-dev' },
            { id: 'frontend', label: '前端开发', nodeId: 'frontend-dev' },
          ],
          waitAll: true,
        },
        position: { x: 100, y: 650 },
      },
      {
        id: 'backend-dev',
        type: 'tool',
        label: '后端开发',
        config: {
          toolName: 'write_file',
          arguments: {
            path: '${variables.backendPath}',
            content: '${outputs.design.backend}',
          },
        },
        position: { x: 50, y: 750 },
      },
      {
        id: 'frontend-dev',
        type: 'tool',
        label: '前端开发',
        config: {
          toolName: 'write_file',
          arguments: {
            path: '${variables.frontendPath}',
            content: '${outputs.design.frontend}',
          },
        },
        position: { x: 250, y: 750 },
      },
      {
        id: 'write-tests',
        type: 'tool',
        label: '编写测试',
        description: '编写单元测试和集成测试',
        config: {
          toolName: 'write_file',
          arguments: {
            path: '${variables.testPath}',
            content: '${outputs.design.tests}',
          },
        },
        position: { x: 100, y: 850 },
      },
      {
        id: 'run-tests',
        type: 'tool',
        label: '运行测试',
        description: '执行测试套件',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'npm test',
          },
        },
        position: { x: 100, y: 950 },
      },
      {
        id: 'check-tests',
        type: 'decision',
        label: '测试通过？',
        config: {
          condition: 'outputs["run-tests"].exitCode === 0',
          trueNext: 'end',
          falseNext: 'fix-issues',
        },
        position: { x: 100, y: 1050 },
      },
      {
        id: 'fix-issues',
        type: 'llm',
        label: '修复问题',
        description: '分析测试失败原因并修复',
        config: {
          prompt: '测试失败，请分析原因并提供修复方案：\n\n${outputs["run-tests"].output}',
          outputVariable: 'fixes',
        },
        position: { x: 250, y: 1050 },
      },
      {
        id: 'end',
        type: 'end',
        label: '完成',
        config: {},
        position: { x: 100, y: 1150 },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ask-requirements' },
      { id: 'e2', source: 'ask-requirements', target: 'generate-design' },
      { id: 'e3', source: 'generate-design', target: 'confirm-design' },
      { id: 'e4', source: 'confirm-design', target: 'check-approval' },
      { id: 'e5', source: 'check-approval', target: 'create-structure', condition: 'true' },
      { id: 'e6', source: 'check-approval', target: 'generate-design', condition: 'false' },
      { id: 'e7', source: 'create-structure', target: 'parallel-dev' },
      { id: 'e8', source: 'parallel-dev', target: 'write-tests' },
      { id: 'e9', source: 'write-tests', target: 'run-tests' },
      { id: 'e10', source: 'run-tests', target: 'check-tests' },
      { id: 'e11', source: 'check-tests', target: 'end', condition: 'true' },
      { id: 'e12', source: 'check-tests', target: 'fix-issues', condition: 'false' },
      { id: 'e13', source: 'fix-issues', target: 'run-tests' },
    ],
    config: {
      maxRetries: 3,
      timeout: 3600000, // 1 hour
      continueOnError: false,
      variables: {},
      environment: 'development',
    },
  },
  parameters: [
    {
      name: 'projectPath',
      label: '项目路径',
      type: 'string',
      required: true,
    },
    {
      name: 'backendPath',
      label: '后端代码路径',
      type: 'string',
      required: true,
    },
    {
      name: 'frontendPath',
      label: '前端代码路径',
      type: 'string',
      required: true,
    },
    {
      name: 'testPath',
      label: '测试代码路径',
      type: 'string',
      required: true,
    },
  ],
}

// ===== Bug 修复模板 =====

export const bugFixTemplate: WorkflowTemplate = {
  id: 'bug-fix',
  name: 'Bug 修复',
  description: '系统化的 Bug 修复流程',
  category: 'maintenance',
  tags: ['bug', 'fix', 'debugging'],
  workflow: {
    name: 'Bug 修复',
    description: 'Bug 修复标准流程',
    version: '1.0.0',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: '开始',
        config: {},
      },
      {
        id: 'describe-bug',
        type: 'ask',
        label: '描述问题',
        config: {
          question: '请描述 Bug 的现象和复现步骤',
          type: 'textarea',
          outputVariable: 'bugDescription',
        },
      },
      {
        id: 'reproduce',
        type: 'tool',
        label: '复现问题',
        config: {
          toolName: 'run_command',
          arguments: {
            command: '${variables.reproduceCommand}',
          },
        },
      },
      {
        id: 'analyze',
        type: 'llm',
        label: '分析原因',
        config: {
          prompt: 'Bug 描述：\n${userInputs.bugDescription}\n\n复现结果：\n${outputs.reproduce.output}\n\n请分析根本原因',
          outputVariable: 'analysis',
        },
      },
      {
        id: 'fix-code',
        type: 'tool',
        label: '修复代码',
        config: {
          toolName: 'write_file',
          arguments: {
            path: '${variables.filePath}',
            content: '${outputs.analysis.fixedCode}',
          },
        },
      },
      {
        id: 'verify',
        type: 'tool',
        label: '验证修复',
        config: {
          toolName: 'run_command',
          arguments: {
            command: '${variables.verifyCommand}',
          },
        },
      },
      {
        id: 'regression-tests',
        type: 'loop',
        label: '回归测试',
        config: {
          items: 'variables.testCases',
          itemVariable: 'testCase',
          indexVariable: 'testIndex',
          bodyNodeId: 'run-test',
          maxIterations: 100,
        },
      },
      {
        id: 'run-test',
        type: 'tool',
        label: '运行测试',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'npm test ${loops.regression-tests.currentItem}',
          },
        },
      },
      {
        id: 'end',
        type: 'end',
        label: '完成',
        config: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'describe-bug' },
      { id: 'e2', source: 'describe-bug', target: 'reproduce' },
      { id: 'e3', source: 'reproduce', target: 'analyze' },
      { id: 'e4', source: 'analyze', target: 'fix-code' },
      { id: 'e5', source: 'fix-code', target: 'verify' },
      { id: 'e6', source: 'verify', target: 'regression-tests' },
      { id: 'e7', source: 'regression-tests', target: 'end' },
    ],
    config: {
      maxRetries: 3,
      timeout: 1800000, // 30 minutes
      continueOnError: false,
      variables: {},
      environment: 'development',
    },
  },
  parameters: [
    {
      name: 'reproduceCommand',
      label: '复现命令',
      type: 'string',
      required: true,
    },
    {
      name: 'filePath',
      label: '修复文件路径',
      type: 'string',
      required: true,
    },
    {
      name: 'verifyCommand',
      label: '验证命令',
      type: 'string',
      required: true,
    },
    {
      name: 'testCases',
      label: '测试用例列表',
      type: 'string',
      required: false,
      defaultValue: [],
    },
  ],
}

// ===== 代码审查模板 =====

export const codeReviewTemplate: WorkflowTemplate = {
  id: 'code-review',
  name: '代码审查',
  description: '自动化代码审查流程',
  category: 'quality',
  tags: ['review', 'quality', 'code'],
  workflow: {
    name: '代码审查',
    description: '自动化代码审查',
    version: '1.0.0',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: '开始',
        config: {},
      },
      {
        id: 'get-changes',
        type: 'tool',
        label: '获取变更文件',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'git diff --name-only ${variables.baseBranch}',
          },
        },
      },
      {
        id: 'parse-files',
        type: 'transform',
        label: '解析文件列表',
        config: {
          input: 'outputs["get-changes"].output',
          transform: 'input.split("\\n").filter(f => f.trim())',
          output: 'changedFiles',
        },
      },
      {
        id: 'review-loop',
        type: 'loop',
        label: '逐文件审查',
        config: {
          items: 'variables.changedFiles',
          itemVariable: 'file',
          indexVariable: 'fileIndex',
          bodyNodeId: 'review-file',
        },
      },
      {
        id: 'review-file',
        type: 'llm',
        label: '审查文件',
        config: {
          prompt: '请审查以下文件的变更：\n\n文件：${loops["review-loop"].currentItem}\n\n请检查：\n1. 代码质量\n2. 潜在问题\n3. 最佳实践\n4. 安全隐患',
          outputVariable: 'fileReview',
        },
      },
      {
        id: 'generate-report',
        type: 'llm',
        label: '生成审查报告',
        config: {
          prompt: '基于所有文件的审查结果，生成总结报告',
          outputVariable: 'report',
        },
      },
      {
        id: 'ask-approval',
        type: 'ask',
        label: '是否批准？',
        config: {
          question: '审查完成，是否批准这些变更？',
          type: 'confirm',
          outputVariable: 'approved',
        },
      },
      {
        id: 'end',
        type: 'end',
        label: '完成',
        config: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'get-changes' },
      { id: 'e2', source: 'get-changes', target: 'parse-files' },
      { id: 'e3', source: 'parse-files', target: 'review-loop' },
      { id: 'e4', source: 'review-loop', target: 'generate-report' },
      { id: 'e5', source: 'generate-report', target: 'ask-approval' },
      { id: 'e6', source: 'ask-approval', target: 'end' },
    ],
    config: {
      maxRetries: 2,
      timeout: 1800000,
      continueOnError: true,
      variables: {},
      environment: 'development',
    },
  },
  parameters: [
    {
      name: 'baseBranch',
      label: '基准分支',
      type: 'string',
      required: false,
      defaultValue: 'main',
    },
  ],
}

// ===== 重构模板 =====

export const refactoringTemplate: WorkflowTemplate = {
  id: 'refactoring',
  name: '代码重构',
  description: '安全的代码重构流程',
  category: 'maintenance',
  tags: ['refactor', 'quality', 'improvement'],
  workflow: {
    name: '代码重构',
    description: '安全的重构流程',
    version: '1.0.0',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: '开始',
        config: {},
      },
      {
        id: 'ask-target',
        type: 'ask',
        label: '选择重构目标',
        config: {
          question: '请选择要重构的代码',
          type: 'input',
          outputVariable: 'targetFile',
        },
      },
      {
        id: 'run-tests-before',
        type: 'tool',
        label: '运行测试（重构前）',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'npm test',
          },
        },
      },
      {
        id: 'analyze-code',
        type: 'llm',
        label: '分析代码',
        config: {
          prompt: '分析以下代码的重构机会：\n\n${variables.targetCode}\n\n请提供重构建议',
          outputVariable: 'refactorPlan',
        },
      },
      {
        id: 'confirm-plan',
        type: 'ask',
        label: '确认重构计划',
        config: {
          question: '请确认重构计划',
          type: 'confirm',
          outputVariable: 'planApproved',
        },
      },
      {
        id: 'refactor-code',
        type: 'tool',
        label: '执行重构',
        config: {
          toolName: 'write_file',
          arguments: {
            path: '${userInputs.targetFile}',
            content: '${outputs.refactorPlan.refactoredCode}',
          },
        },
      },
      {
        id: 'run-tests-after',
        type: 'tool',
        label: '运行测试（重构后）',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'npm test',
          },
        },
      },
      {
        id: 'check-tests',
        type: 'decision',
        label: '测试通过？',
        config: {
          condition: 'outputs["run-tests-after"].exitCode === 0',
          trueNext: 'end',
          falseNext: 'rollback',
        },
      },
      {
        id: 'rollback',
        type: 'tool',
        label: '回滚变更',
        config: {
          toolName: 'run_command',
          arguments: {
            command: 'git checkout ${userInputs.targetFile}',
          },
        },
      },
      {
        id: 'end',
        type: 'end',
        label: '完成',
        config: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ask-target' },
      { id: 'e2', source: 'ask-target', target: 'run-tests-before' },
      { id: 'e3', source: 'run-tests-before', target: 'analyze-code' },
      { id: 'e4', source: 'analyze-code', target: 'confirm-plan' },
      { id: 'e5', source: 'confirm-plan', target: 'refactor-code' },
      { id: 'e6', source: 'refactor-code', target: 'run-tests-after' },
      { id: 'e7', source: 'run-tests-after', target: 'check-tests' },
      { id: 'e8', source: 'check-tests', target: 'end', condition: 'true' },
      { id: 'e9', source: 'check-tests', target: 'rollback', condition: 'false' },
      { id: 'e10', source: 'rollback', target: 'end' },
    ],
    config: {
      maxRetries: 2,
      timeout: 1800000,
      continueOnError: false,
      variables: {},
      environment: 'development',
    },
  },
  parameters: [],
}

// ===== 导出所有模板 =====

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  'feature-development': featureDevelopmentTemplate,
  'bug-fix': bugFixTemplate,
  'code-review': codeReviewTemplate,
  'refactoring': refactoringTemplate,
}

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES[id]
}

export function getAllTemplates(): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES)
}

export function getTemplatesByCategory(category: string): WorkflowTemplate[] {
  return getAllTemplates().filter(t => t.category === category)
}

export function getTemplatesByTag(tag: string): WorkflowTemplate[] {
  return getAllTemplates().filter(t => t.tags.includes(tag))
}
