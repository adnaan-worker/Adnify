# Task Launch And Isolation Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the loop from visible execution tasks to runnable task execution by adding an explicit task launch flow and binding isolated workspaces to the real execution lifecycle with cleanup.

**Architecture:** Keep the current task board as the launch surface instead of introducing a new route. Add a lightweight execution-task draft UI in the renderer, extend execution-task state with resolved workspace lifecycle fields, and make the orchestrator executor prepare/dispose isolated workspaces per task. Favor narrow state additions and service helpers over broad refactors.

**Tech Stack:** React, Zustand, Electron IPC, Vitest, TypeScript

---

### Task 1: Extend execution-task domain for workspace lifecycle

**Files:**
- Modify: `src/renderer/agent/types/taskExecution.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Test: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing test**

Add a test that creates an execution task and verifies default workspace lifecycle fields exist (`sourceWorkspacePath`, `resolvedWorkspacePath`, `isolationStatus`, `isolationMode`, `isolationError`).

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: FAIL because lifecycle fields are missing.

**Step 3: Write minimal implementation**

Extend `ExecutionTask` and `CreateExecutionTaskInput` with task-scoped workspace metadata. Populate defaults in `createExecutionTask()` and add an update helper for lifecycle fields.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: PASS.

### Task 2: Add explicit execution-task launch UI on TaskBoard

**Files:**
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Create: `src/renderer/components/orchestrator/ExecutionTaskComposer.tsx`
- Test: `tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`

**Step 1: Write the failing test**

Add a test that renders the task board with a plan, opens the composer, creates an execution task draft, and verifies the selected task shows the chosen trust mode and target.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`
Expected: FAIL because composer UI does not exist.

**Step 3: Write minimal implementation**

Add a compact composer panel with objective, specialist template/manual roles, trust mode, and execution target. When submitted, call `createExecutionTask()` with the current workspace path and select the new task.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`
Expected: PASS.

### Task 3: Bind isolated workspace prepare/dispose to execution lifecycle

**Files:**
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/services/electronAPI.ts`
- Test: `tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- preparing an isolated workspace before execution when the active task target resolves to `isolated`
- running the loop against `resolvedWorkspacePath`
- disposing the isolated workspace on stop and after completion/failure
- preserving cleanup safety when workspace creation fails

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts`
Expected: FAIL because task-scoped isolation lifecycle is not implemented.

**Step 3: Write minimal implementation**

Add helper functions in `orchestratorExecutor` to resolve the active execution task, prepare task workspace via `api.workspace.createIsolated()`, persist lifecycle state back into the store, use `resolvedWorkspacePath` for execution, and dispose via `api.workspace.disposeIsolated()` from success/failure/stop paths.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts`
Expected: PASS.

### Task 4: Add safety cleanup verification and regression pass

**Files:**
- Modify: `tests/main/security/isolatedWorkspace.test.ts`
- Run only existing implementation files if needed

**Step 1: Write the failing test**

Extend isolated workspace tests to verify duplicate dispose is safe and cleanup returns success when a task record is already gone.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: FAIL if cleanup semantics are incomplete.

**Step 3: Write minimal implementation**

Keep `disposeIsolatedWorkspace()` idempotent and ensure task lifecycle callers tolerate repeated cleanup.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: PASS.

### Task 5: Full verification before branch handoff

**Files:**
- No code changes required unless verification finds issues

**Step 1: Run focused tests**

Run: `npx vitest run tests/agent/store/taskOrchestratorSlice.test.ts tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx tests/agent/services/orchestratorExecutorIsolation.test.ts tests/main/security/isolatedWorkspace.test.ts`
Expected: PASS.

**Step 2: Run typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS.

**Step 4: Run production build**

Run: `npm run build`
Expected: PASS.
