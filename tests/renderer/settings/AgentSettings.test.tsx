import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AgentSettings } from '@renderer/components/settings/tabs/AgentSettings'
import type { AgentSettingsProps } from '@renderer/components/settings/types'
import { normalizeTaskTrustSettings } from '@renderer/components/settings/types'
import { SETTINGS } from '@shared/config/settings'

vi.mock('@renderer/agent/prompts/promptTemplates', () => ({
  getPromptTemplates: () => [
    {
      id: 'default',
      name: 'Default Template',
      isDefault: true,
      priority: 1,
      tags: ['General'],
      description: 'Default template',
      descriptionZh: '默认模板',
    },
  ],
}))

vi.mock('@renderer/components/settings/tabs/PromptPreviewModal', () => ({
  PromptPreviewModal: () => null,
}))

vi.mock('@components/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: ({ className = '', ...props }: any) => <input className={className} {...props} />,
  Select: ({ options, value, className = '' }: any) => {
    const selected = options.find((option: { value: string; label: string }) => option.value === value)
    return <div className={className}>{selected?.label ?? value}</div>
  },
  Switch: ({ label, checked }: any) => (
    <label>
      <span>{label}</span>
      <input type="checkbox" checked={checked} readOnly />
    </label>
  ),
}))

function createProps(): AgentSettingsProps {
  const noop = vi.fn()

  return {
    autoApprove: SETTINGS.autoApprove.default,
    setAutoApprove: noop,
    aiInstructions: '',
    setAiInstructions: noop,
    promptTemplateId: 'default',
    setPromptTemplateId: noop,
    agentConfig: SETTINGS.agentConfig.default,
    setAgentConfig: noop as AgentSettingsProps['setAgentConfig'],
    webSearchConfig: SETTINGS.webSearchConfig.default,
    setWebSearchConfig: noop as AgentSettingsProps['setWebSearchConfig'],
    taskTrustSettings: normalizeTaskTrustSettings(SETTINGS.taskTrustSettings.default),
    setTaskTrustSettings: noop as AgentSettingsProps['setTaskTrustSettings'],
    language: 'zh',
  }
}

describe('AgentSettings specialist profiles UI', () => {
  it('renders readable specialist summaries and grouped settings copy', () => {
    const html = renderToStaticMarkup(<AgentSettings {...createProps()} />)

    expect(html).toContain('为不同专家设置默认模型、权限和预算上限')
    expect(html).toContain('基础设置')
    expect(html).toContain('权限设置')
    expect(html).toContain('预算上限')
    expect(html).toContain('lg:col-span-2')
    expect(html).toContain('工具：工作区可写')
    expect(html).toContain('网络：工作区网络')
    expect(html).toContain('界面实现与交互细节')
  })

  it('renders routing-policy and verification-mode controls for task trust settings', () => {
    const html = renderToStaticMarkup(<AgentSettings {...createProps()} />)

    expect(html).toContain('模型路由策略')
    expect(html).toContain('预算感知')
    expect(html).toContain('验证模式')
    expect(html).toContain('浏览器验证')
    expect(html).toContain('回归验证')
    expect(html).toContain('静态检查')
  })
})
