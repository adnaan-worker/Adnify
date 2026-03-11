import { describe, expect, it } from 'vitest'

import { getToolsForContext } from '@shared/config/toolGroups'

describe('toolGroups', () => {
  it('exposes interactive terminal follow-up tools in agent mode', () => {
    const tools = getToolsForContext({ mode: 'agent' })

    expect(tools).toContain('run_command')
    expect(tools).toContain('read_terminal_output')
    expect(tools).toContain('send_terminal_input')
    expect(tools).toContain('stop_terminal')
  })

  it('keeps planning-only orchestrator mode limited to planning tools', () => {
    const tools = getToolsForContext({ mode: 'orchestrator', orchestratorPhase: 'planning' })

    expect(tools).toContain('create_task_plan')
    expect(tools).not.toContain('run_command')
    expect(tools).not.toContain('read_terminal_output')
  })
})
