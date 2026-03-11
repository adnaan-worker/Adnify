# Solo Agent IDE MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first runnable slice of Adnify's solo-agent IDE workflow: task objects, trust presets, isolated task workspaces, visible work packages, coordinator-controlled handoff, and circuit-breaker safety.

**Architecture:** Extend the existing orchestrator and agent store into a task-first execution model instead of a chat-first execution model. Keep the first slice narrow: add strongly typed task/work-package data structures, persist trust policy in settings, add a main-process isolated-workspace service, and surface coordinator + handoff state in the existing task board and settings UI.

**Tech Stack:** Electron 39, React 18, TypeScript 5, Zustand, existing orchestrator slices/services, Vitest, Electron IPC, existing security/workspace modules.

---

### Task 1: Add core task and trust domain types

**Files:**
- Create: `src/renderer/agent/types/taskExecution.ts`
- Create: `src/renderer/agent/types/trustPolicy.ts`
- Modify: `src/renderer/agent/orchestrator/types.ts`
- Modify: `src/renderer/components/settings/types.ts`
- Test: `tests/agent/orchestrator/taskExecutionTypes.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRUST_POLICY, shouldUseIsolatedWorkspace } from '@renderer/agent/types/trustPolicy'

describe('task execution types', () => {
  it('defaults to balanced trust with isolation enabled', () => {
    expect(DEFAULT_TRUST_POLICY.mode).toBe('balanced')
    expect(DEFAULT_TRUST_POLICY.enableSafetyGuards).toBe(true)
  })

  it('routes medium and large work into isolated workspaces', () => {
    expect(shouldUseIsolatedWorkspace({ risk: 'medium', fileCount: 4 })).toBe(true)
    expect(shouldUseIsolatedWorkspace({ risk: 'low', fileCount: 1 })).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/orchestrator/taskExecutionTypes.test.ts`
Expected: FAIL because `taskExecution.ts` and `trustPolicy.ts` do not exist.

**Step 3: Write minimal implementation**

```ts
export type TrustMode = 'safe' | 'balanced' | 'autonomous' | 'manual'

export interface TrustPolicy {
  mode: TrustMode
  enableSafetyGuards: boolean
  defaultExecutionTarget: 'current' | 'isolated' | 'auto'
  interruptMode: 'phase' | 'high-risk' | 'failure-only'
}

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  mode: 'balanced',
  enableSafetyGuards: true,
  defaultExecutionTarget: 'auto',
  interruptMode: 'phase',
}

export function shouldUseIsolatedWorkspace(input: { risk: 'low' | 'medium' | 'high'; fileCount: number }) {
  return input.risk !== 'low' || input.fileCount > 1
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/orchestrator/taskExecutionTypes.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/orchestrator/taskExecutionTypes.test.ts src/renderer/agent/types/taskExecution.ts src/renderer/agent/types/trustPolicy.ts src/renderer/agent/orchestrator/types.ts src/renderer/components/settings/types.ts
git commit -m "feat: add task execution domain types"
```

### Task 2: Persist trust presets and task execution preferences in settings

**Files:**
- Modify: `src/renderer/components/settings/tabs/AgentSettings.tsx`
- Modify: `src/renderer/components/settings/tabs/SecuritySettings.tsx`
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`
- Modify: `src/main/ipc/settings.ts`
- Test: `tests/services/taskTrustSettings.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeTaskTrustSettings } from '@renderer/components/settings/types'

describe('task trust settings', () => {
  it('hydrates defaults for global, workspace, and task overrides', () => {
    const settings = normalizeTaskTrustSettings(undefined)
    expect(settings.global.mode).toBe('balanced')
    expect(settings.workspaceOverrides).toEqual({})
    expect(settings.allowTaskOverride).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/taskTrustSettings.test.ts`
Expected: FAIL because `normalizeTaskTrustSettings` does not exist.

**Step 3: Write minimal implementation**

```ts
export interface TaskTrustSettings {
  global: TrustPolicy
  workspaceOverrides: Record<string, TrustPolicy>
  allowTaskOverride: boolean
}

export function normalizeTaskTrustSettings(input?: Partial<TaskTrustSettings>): TaskTrustSettings {
  return {
    global: { ...DEFAULT_TRUST_POLICY, ...input?.global },
    workspaceOverrides: input?.workspaceOverrides ?? {},
    allowTaskOverride: input?.allowTaskOverride ?? true,
  }
}
```

Add a first UI slice with:
- trust mode preset picker
- safety guards toggle
- default execution target selector
- interrupt mode selector

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/taskTrustSettings.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/services/taskTrustSettings.test.ts src/renderer/components/settings/tabs/AgentSettings.tsx src/renderer/components/settings/tabs/SecuritySettings.tsx src/renderer/components/settings/types.ts src/renderer/components/settings/SettingsModal.tsx src/main/ipc/settings.ts
git commit -m "feat: add task trust settings"
```

### Task 3: Add task, work package, and handoff state to the orchestrator store

**Files:**
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/agent/store/slices/index.ts`
- Modify: `src/renderer/agent/store/AgentStore.ts`
- Create: `src/renderer/agent/services/taskTemplateService.ts`
- Test: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('task orchestrator slice', () => {
  it('creates a task with visible work packages and specialist assignments', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Build auth pages',
      specialists: ['frontend', 'logic'],
    })

    const task = store.executionTasks[taskId]
    expect(task.specialists).toEqual(['frontend', 'logic'])
    expect(task.workPackages.length).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: FAIL because execution task APIs do not exist.

**Step 3: Write minimal implementation**

```ts
export interface ExecutionTask {
  id: string
  objective: string
  specialists: string[]
  state: 'planning' | 'running' | 'verifying' | 'blocked' | 'complete' | 'tripped'
  workPackages: string[]
}

createExecutionTask(input) {
  const taskId = crypto.randomUUID()
  const packageId = crypto.randomUUID()
  set((state) => {
    state.executionTasks[taskId] = {
      id: taskId,
      objective: input.objective,
      specialists: input.specialists,
      state: 'planning',
      workPackages: [packageId],
    }
    state.workPackages[packageId] = {
      id: packageId,
      taskId,
      title: input.objective,
      specialist: input.specialists[0],
      status: 'queued',
      writableScopes: [],
      dependsOn: [],
    }
  })
  return taskId
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/store/taskOrchestratorSlice.test.ts src/renderer/agent/store/slices/orchestratorSlice.ts src/renderer/agent/store/slices/index.ts src/renderer/agent/store/AgentStore.ts src/renderer/agent/services/taskTemplateService.ts
git commit -m "feat: add execution task state"
```

### Task 4: Implement isolated task workspace primitives in the main process

**Files:**
- Create: `src/main/security/isolatedWorkspace.ts`
- Modify: `src/main/security/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/services/electronAPI.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Test: `tests/main/security/isolatedWorkspace.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { chooseIsolationMode } from '@main/security/isolatedWorkspace'

describe('isolated workspace', () => {
  it('prefers git worktree for git repositories', () => {
    expect(chooseIsolationMode({ hasGit: true, hasUncommittedChanges: false })).toBe('worktree')
  })

  it('falls back to temp copy outside git', () => {
    expect(chooseIsolationMode({ hasGit: false, hasUncommittedChanges: false })).toBe('copy')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: FAIL because `isolatedWorkspace.ts` does not exist.

**Step 3: Write minimal implementation**

```ts
export type IsolationMode = 'worktree' | 'copy'

export function chooseIsolationMode(input: { hasGit: boolean; hasUncommittedChanges: boolean }): IsolationMode {
  return input.hasGit ? 'worktree' : 'copy'
}
```

Then add IPC methods for:
- previewing isolation choice
- creating an isolated workspace for a task
- disposing it after completion or rollback

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/main/security/isolatedWorkspace.test.ts src/main/security/isolatedWorkspace.ts src/main/security/index.ts src/main/preload.ts src/renderer/services/electronAPI.ts src/renderer/types/electron.d.ts
git commit -m "feat: add isolated task workspace primitives"
```

### Task 5: Add coordinator-side merge gate and handoff validation

**Files:**
- Create: `src/renderer/agent/services/coordinatorService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/orchestrator/ExecutionScheduler.ts`
- Test: `tests/agent/services/coordinatorService.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { validateHandoffForMerge } from '@renderer/agent/services/coordinatorService'

describe('coordinator merge gate', () => {
  it('blocks handoffs that modify files outside writable scopes', () => {
    const result = validateHandoffForMerge({
      writableScopes: ['src/renderer/components/settings'],
      changedFiles: ['src/main/main.ts'],
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('outside writable scopes')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/services/coordinatorService.test.ts`
Expected: FAIL because `coordinatorService.ts` does not exist.

**Step 3: Write minimal implementation**

```ts
export function validateHandoffForMerge(input: { writableScopes: string[]; changedFiles: string[] }) {
  const outOfScope = input.changedFiles.filter(
    (file) => !input.writableScopes.some((scope) => file.startsWith(scope)),
  )

  return outOfScope.length === 0
    ? { ok: true as const }
    : { ok: false as const, reason: `Changed files outside writable scopes: ${outOfScope.join(', ')}` }
}
```

Then wire the coordinator gate into the existing orchestrator executor before any task result becomes mergeable.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/services/coordinatorService.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/services/coordinatorService.test.ts src/renderer/agent/services/coordinatorService.ts src/renderer/agent/services/orchestratorExecutor.ts src/renderer/agent/orchestrator/ExecutionScheduler.ts
git commit -m "feat: add coordinator merge gate"
```

### Task 6: Surface execution tasks, work packages, and handoffs in the task board

**Files:**
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Create: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Create: `src/renderer/components/orchestrator/WorkPackageColumn.tsx`
- Create: `src/renderer/components/orchestrator/HandoffDetailPanel.tsx`
- Test: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExecutionTaskPanel } from '@renderer/components/orchestrator/ExecutionTaskPanel'

describe('ExecutionTaskPanel', () => {
  it('shows specialists, trust mode, and work package columns', () => {
    render(<ExecutionTaskPanel task={{ objective: 'Ship onboarding', specialists: ['frontend', 'logic'], state: 'running' }} />)
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.getByText('logic')).toBeTruthy()
    expect(screen.getByText(/running/i)).toBeTruthy()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
Expected: FAIL because execution task panel components do not exist.

**Step 3: Write minimal implementation**

```tsx
export function ExecutionTaskPanel({ task }: { task: ExecutionTask }) {
  return (
    <section>
      <h2>{task.objective}</h2>
      <p>{task.state}</p>
      <div>{task.specialists.map((specialist) => <span key={specialist}>{specialist}</span>)}</div>
    </section>
  )
}
```

Then extend `TaskBoard.tsx` to render:
- task status summary
- specialist roster
- work package columns
- selected handoff detail panel

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/orchestrator/taskBoardExecutionView.test.tsx src/renderer/components/orchestrator/TaskBoard.tsx src/renderer/components/orchestrator/ExecutionTaskPanel.tsx src/renderer/components/orchestrator/WorkPackageColumn.tsx src/renderer/components/orchestrator/HandoffDetailPanel.tsx
git commit -m "feat: show execution tasks in task board"
```

### Task 7: Add circuit-breaker and budget tracking for multi-agent execution

**Files:**
- Create: `src/renderer/agent/services/circuitBreakerService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Create: `src/renderer/components/orchestrator/CircuitBreakerBanner.tsx`
- Test: `tests/agent/services/circuitBreakerService.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { shouldTripCircuitBreaker } from '@renderer/agent/services/circuitBreakerService'

describe('circuit breaker', () => {
  it('trips when retries exceed threshold without net progress', () => {
    const result = shouldTripCircuitBreaker({
      retryCount: 3,
      repeatedCommands: 3,
      repeatedFiles: 2,
      progressDelta: 0,
    })

    expect(result.trip).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/services/circuitBreakerService.test.ts`
Expected: FAIL because `circuitBreakerService.ts` does not exist.

**Step 3: Write minimal implementation**

```ts
export function shouldTripCircuitBreaker(input: {
  retryCount: number
  repeatedCommands: number
  repeatedFiles: number
  progressDelta: number
}) {
  const stalled = input.progressDelta <= 0
  const repeated = input.retryCount >= 3 || input.repeatedCommands >= 3 || input.repeatedFiles >= 2
  return repeated && stalled
    ? { trip: true as const, reason: 'Detected repeated work without net progress' }
    : { trip: false as const }
}
```

Then store the breaker state on the task and render it in a banner with a short report.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/services/circuitBreakerService.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/services/circuitBreakerService.test.ts src/renderer/agent/services/circuitBreakerService.ts src/renderer/agent/services/orchestratorExecutor.ts src/renderer/agent/store/slices/orchestratorSlice.ts src/renderer/components/orchestrator/CircuitBreakerBanner.tsx
git commit -m "feat: add multi-agent circuit breaker"
```

### Task 8: Add specialist templates for manual multi-agent setup

**Files:**
- Modify: `src/renderer/agent/services/taskTemplateService.ts`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Create: `src/renderer/components/orchestrator/TaskTemplatePicker.tsx`
- Test: `tests/agent/services/taskTemplateService.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { getTaskTemplates } from '@renderer/agent/services/taskTemplateService'

describe('task template service', () => {
  it('returns a template for frontend + logic + verifier collaboration', () => {
    const template = getTaskTemplates().find((item) => item.id === 'frontend-logic-verifier')
    expect(template?.specialists).toEqual(['frontend', 'logic', 'verifier'])
    expect(template?.workPackages.length).toBeGreaterThan(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/services/taskTemplateService.test.ts`
Expected: FAIL because templates are not implemented.

**Step 3: Write minimal implementation**

```ts
export function getTaskTemplates() {
  return [
    {
      id: 'frontend-logic-verifier',
      label: 'Frontend + Logic + Verifier',
      specialists: ['frontend', 'logic', 'verifier'],
      workPackages: [
        { title: 'Build UI shell', specialist: 'frontend' },
        { title: 'Wire state and actions', specialist: 'logic' },
        { title: 'Run regression checks', specialist: 'verifier' },
      ],
    },
  ]
}
```

Then expose template selection in the execution task creation flow.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/services/taskTemplateService.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/services/taskTemplateService.test.ts src/renderer/agent/services/taskTemplateService.ts src/renderer/components/orchestrator/ExecutionTaskPanel.tsx src/renderer/components/orchestrator/TaskTemplatePicker.tsx
git commit -m "feat: add specialist task templates"
```

### Final verification

**Run the focused suite**

```bash
npx vitest run \
  tests/agent/orchestrator/taskExecutionTypes.test.ts \
  tests/services/taskTrustSettings.test.ts \
  tests/agent/store/taskOrchestratorSlice.test.ts \
  tests/main/security/isolatedWorkspace.test.ts \
  tests/agent/services/coordinatorService.test.ts \
  tests/agent/orchestrator/taskBoardExecutionView.test.tsx \
  tests/agent/services/circuitBreakerService.test.ts \
  tests/agent/services/taskTemplateService.test.ts
```

Expected: All tests pass.

**Run type-check**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: Exit code 0.

**Run build**

```bash
npm run build:main && npm run build
```

Expected: Exit code 0.
