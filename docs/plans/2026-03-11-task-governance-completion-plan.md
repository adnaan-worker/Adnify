# Task Governance Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining task-governance capabilities for Adnify by adding budget tracking, adjudication flow, conservative rollback orchestration, and specialist profile configuration on top of the existing task-first architecture.

**Architecture:** Reuse the current execution task, work package, handoff, coordinator, circuit breaker, and isolated workspace flows. Add explicit governance state plus lightweight services for budget ledgers, adjudication cases, rollback proposals, and specialist profile resolution. Keep defaults conservative and task-safe.

**Tech Stack:** React, Zustand, Electron, TypeScript, Vitest

---

### Task 1: Extend task governance domain and settings models

**Files:**
- Modify: `src/renderer/agent/types/taskExecution.ts`
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/shared/config/types.ts`
- Modify: `src/shared/config/settings.ts`
- Modify: `src/shared/config/configCleaner.ts`
- Modify: `src/renderer/settings/index.ts`
- Modify: `src/renderer/settings/service.ts`
- Modify: `src/renderer/settings/exportImport.ts`
- Test: `tests/agent/orchestrator/taskExecutionTypes.test.ts`
- Test: `tests/services/taskTrustSettings.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- `ExecutionTask` normalization includes governance state, budget defaults, rollback defaults, and specialist profile snapshot placeholders
- task governance settings hydrate conservative defaults for budgets and specialist profiles

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/agent/orchestrator/taskExecutionTypes.test.ts tests/services/taskTrustSettings.test.ts`

**Step 3: Write minimal implementation**

Add explicit types for:
- budget dimensions, usage, warning state, and trip report
- adjudication case and actions
- rollback proposal and rollback capability snapshot
- specialist profiles and governance defaults

Normalize them through existing settings and config paths.

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/agent/orchestrator/taskExecutionTypes.test.ts tests/services/taskTrustSettings.test.ts`

---

### Task 2: Add specialist profile settings UI and persistence

**Files:**
- Modify: `src/renderer/components/settings/tabs/AgentSettings.tsx`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`
- Modify: `src/renderer/components/settings/tabs/SystemSettings.tsx`
- Modify: `src/renderer/store/slices/settingsSlice.ts`
- Test: `tests/services/taskTrustSettings.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- specialist profiles default to conservative per-role behavior
- settings updates persist profile overrides cleanly

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/services/taskTrustSettings.test.ts`

**Step 3: Write minimal implementation**

Add settings UI for:
- per-specialist model
- tool/network/git permission strength
- budget caps
- writable scope defaults
- style hints and validation role

Persist through the existing settings store.

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/services/taskTrustSettings.test.ts`

---

### Task 3: Add budget ledger service and trip reporting

**Files:**
- Create: `src/renderer/agent/services/budgetLedgerService.ts`
- Modify: `src/renderer/agent/services/circuitBreakerService.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Create: `tests/agent/services/budgetLedgerService.test.ts`
- Modify: `tests/agent/services/circuitBreakerService.test.ts`
- Modify: `tests/agent/store/taskOrchestratorSlice.test.ts`
- Modify: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:
- budget usage accumulates time, estimated tokens, calls, commands, and verifications
- warnings trigger before hard trips
- hard trips produce a structured report and move the task into adjudication-required state
- the execution panel renders budget state

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/agent/services/budgetLedgerService.test.ts tests/agent/services/circuitBreakerService.test.ts tests/agent/store/taskOrchestratorSlice.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 3: Write minimal implementation**

Add a small ledger service and store helpers to:
- initialize task budgets
- record usage deltas
- emit warnings and trip reports
- surface trip data in task state and UI

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/agent/services/budgetLedgerService.test.ts tests/agent/services/circuitBreakerService.test.ts tests/agent/store/taskOrchestratorSlice.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

---

### Task 4: Add adjudication cases and coordinator decisions

**Files:**
- Modify: `src/renderer/agent/services/coordinatorService.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/components/orchestrator/HandoffDetailPanel.tsx`
- Create: `src/renderer/components/orchestrator/AdjudicationPanel.tsx`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Create: `tests/agent/services/coordinatorAdjudication.test.ts`
- Modify: `tests/agent/services/coordinatorService.test.ts`
- Modify: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:
- unsafe merges, failed verification, and budget trips create adjudication cases
- coordinator decisions can accept, partially accept, return for rework, reassign, require verification, and recommend rollback
- the task view renders adjudication details

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/agent/services/coordinatorService.test.ts tests/agent/services/coordinatorAdjudication.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 3: Write minimal implementation**

Add store state for adjudication cases, coordinator helpers to create and resolve them, and a simple adjudication panel for the selected task.

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/agent/services/coordinatorService.test.ts tests/agent/services/coordinatorAdjudication.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

---

### Task 5: Add conservative rollback orchestration

**Files:**
- Create: `src/renderer/agent/services/rollbackOrchestratorService.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/components/orchestrator/HandoffDetailPanel.tsx`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Create: `tests/agent/services/rollbackOrchestratorService.test.ts`
- Modify: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- isolated tasks generate auto-dispose rollback actions
- main-workspace tasks generate confirmation-required rollback proposals
- external side effects are recorded as warnings, not auto-reverted

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/agent/services/rollbackOrchestratorService.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 3: Write minimal implementation**

Implement rollback proposal generation and store it on the task. Keep automatic behavior conservative.

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/agent/services/rollbackOrchestratorService.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`

---

### Task 6: Wire executor integration for governance transitions

**Files:**
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/services/taskTemplateService.ts`
- Modify: `src/renderer/agent/services/executionWorkspaceService.ts`
- Modify: `src/renderer/agent/orchestrator/ExecutionScheduler.ts`
- Modify: `src/renderer/agent/store/AgentStore.ts`
- Create: `tests/agent/services/orchestratorExecutorGovernance.test.ts`
- Modify: `tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- task creation snapshots specialist profiles and initializes budgets
- execution updates budget usage as commands and verification events occur
- a hard budget trip creates an adjudication case and stops further automatic execution
- rollback proposals are produced on task failure with environment-aware behavior

**Step 2: Run tests to verify they fail**

Run:
`npx vitest run tests/agent/services/orchestratorExecutorGovernance.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 3: Write minimal implementation**

Wire the executor to:
- resolve specialist profiles for the task
- initialize budget state
- record execution events into the ledger
- create adjudication on trip or unsafe merge
- create rollback proposals on failure

**Step 4: Run tests to verify they pass**

Run:
`npx vitest run tests/agent/services/orchestratorExecutorGovernance.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts`

---

### Task 7: Full verification before handoff

**Files:**
- No code changes unless verification finds regressions

**Step 1: Run focused tests**

Run:
`npx vitest run tests/agent/services/budgetLedgerService.test.ts tests/agent/services/coordinatorAdjudication.test.ts tests/agent/services/rollbackOrchestratorService.test.ts tests/agent/services/orchestratorExecutorGovernance.test.ts tests/agent/store/taskOrchestratorSlice.test.ts tests/services/taskTrustSettings.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 2: Run typecheck**

Run:
`npx tsc -p tsconfig.json --noEmit`

**Step 3: Run full tests**

Run:
`npm test`

**Step 4: Run production build**

Run:
`npm run build`
