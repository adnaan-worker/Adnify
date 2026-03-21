# Hybrid Agent IDE Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Adnify's existing agent/orchestrator/security foundations into a unified task-driven hybrid agent IDE flow with a task session model, execution console, patch batch review, and verification gate.

**Architecture:** Add a product-layer `TaskSession` aggregation model above the current `ExecutionTask` / `WorkPackage` / `ChangeProposal` domain, then refactor the renderer panels so task creation, execution visibility, patch review, and verification all follow one stateful pipeline. Reuse the existing orchestrator, trust policy, isolated workspace, secure terminal, and secure file modules instead of replacing them.

**Tech Stack:** React, TypeScript, Zustand, Electron IPC, Vitest, existing orchestrator/taskExecution domain types

---

### Task 1: Add failing domain tests for TaskSession aggregation

**Files:**
- Create: `tests/agent/store/taskSessionModel.test.ts`
- Reference: `src/renderer/agent/types/taskExecution.ts`
- Reference: `src/renderer/agent/store/AgentStore.ts`

**Step 1: Write the failing test**
- Define a minimal `TaskSession` shape expectation:
  - binds one thread
  - binds one active `ExecutionTask`
  - derives patch batch summary from proposals
  - derives verification summary from proposal verification state
- Assert state can represent `define -> plan -> execute -> review -> verify -> complete`.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/store/taskSessionModel.test.ts`
- Expected: FAIL because no `TaskSession` model exists yet.

**Step 3: Implement minimal product model**
- Create a product-layer module, likely under `src/renderer/agent/types/` or `src/renderer/agent/store/`, for:
  - `TaskSession`
  - `ExecutionRun`
  - `PatchBatch`
  - aggregation helpers

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/agent/store/taskSessionModel.test.ts`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/store/taskSessionModel.test.ts src/renderer/agent/types src/renderer/agent/store
git commit -m "feat: add task session aggregation model"
```

### Task 2: Add failing store tests for TaskSession wiring in AgentStore

**Files:**
- Modify: `src/renderer/agent/store/AgentStore.ts`
- Create: `tests/agent/store/taskSessionStore.test.ts`

**Step 1: Write the failing test**
- Assert the store can:
  - create/select a task session
  - bind a thread to a task session
  - bind/update an execution task
  - summarize pending/applied proposals into a patch batch view

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/store/taskSessionStore.test.ts`
- Expected: FAIL because the store does not yet expose task-session-level selectors/actions.

**Step 3: Implement minimal store support**
- Add task-session-level state/actions/selectors to `AgentStore`.
- Keep existing thread/orchestrator slices intact; only aggregate, do not duplicate data.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/agent/store/taskSessionStore.test.ts`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/store/taskSessionStore.test.ts src/renderer/agent/store/AgentStore.ts
git commit -m "feat: wire task session state into agent store"
```

### Task 3: Add failing UI test for batch proposal review

**Files:**
- Create: `tests/renderer/orchestrator/PatchBatchPanel.test.tsx`
- Modify: `src/renderer/components/orchestrator/ChangeProposalPanel.tsx`
- Reference: `src/renderer/components/panels/ComposerPanel.tsx`

**Step 1: Write the failing test**
- Render a batch-level proposal review panel with multiple `ChangeProposal`s.
- Assert it shows:
  - aggregate file count
  - aggregate verification status
  - per-file or per-proposal review affordances
  - disabled apply when any proposal is unverified or conflicted

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/orchestrator/PatchBatchPanel.test.tsx`
- Expected: FAIL because only single-proposal review exists.

**Step 3: Implement minimal batch review UI**
- Introduce a `PatchBatchPanel` or equivalent wrapper near the existing proposal panel.
- Reuse current `ChangeProposalPanel` for single-proposal details.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/renderer/orchestrator/PatchBatchPanel.test.tsx`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/renderer/orchestrator/PatchBatchPanel.test.tsx src/renderer/components/orchestrator
git commit -m "feat: add patch batch review panel"
```

### Task 4: Add failing UI test for unified execution console state

**Files:**
- Create: `tests/renderer/orchestrator/ExecutionConsolePanel.test.tsx`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`

**Step 1: Write the failing test**
- Assert the execution panel can render, in one place:
  - current work package
  - runtime thread activity
  - terminal/tool activity summary
  - verification status summary

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/orchestrator/ExecutionConsolePanel.test.tsx`
- Expected: FAIL because current execution UI is not organized as a unified console abstraction.

**Step 3: Implement minimal execution console refactor**
- Refactor `ExecutionTaskPanel` into a clearer execution console layout.
- Avoid changing orchestrator behavior; only reshape aggregation and presentation first.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/renderer/orchestrator/ExecutionConsolePanel.test.tsx`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/renderer/orchestrator/ExecutionConsolePanel.test.tsx src/renderer/components/orchestrator/ExecutionTaskPanel.tsx
git commit -m "feat: unify execution console state and presentation"
```

### Task 5: Add failing UI test for task-first Composer entry

**Files:**
- Create: `tests/renderer/panels/ComposerTaskSessionEntry.test.tsx`
- Modify: `src/renderer/components/panels/ComposerPanel.tsx`

**Step 1: Write the failing test**
- Assert `ComposerPanel` can support a task-first flow:
  - accepts goal input
  - surfaces success criteria / context affordances
  - can switch between generate-plan mode and patch-review mode

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/panels/ComposerTaskSessionEntry.test.tsx`
- Expected: FAIL because current composer is focused on multi-file edit generation only.

**Step 3: Implement minimal dual-role composer**
- Add a task-session entry mode to `ComposerPanel`.
- Preserve current multi-file edit behavior as the review/apply surface.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/renderer/panels/ComposerTaskSessionEntry.test.tsx`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/renderer/panels/ComposerTaskSessionEntry.test.tsx src/renderer/components/panels/ComposerPanel.tsx
git commit -m "feat: support task-first composer flow"
```

### Task 6: Add domain tests for task-level gates

**Files:**
- Create: `tests/agent/orchestrator/taskSessionGates.test.ts`
- Reference: `src/renderer/agent/types/trustPolicy.ts`
- Reference: `src/renderer/agent/types/taskExecution.ts`

**Step 1: Write the failing test**
- Assert:
  - planning gate blocks execution without plan
  - workspace gate recommends isolation for non-trivial tasks
  - patch gate blocks apply when proposals are conflicted/unverified
  - verify gate blocks completion until verification passes or explicit degraded acceptance is set

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/orchestrator/taskSessionGates.test.ts`
- Expected: FAIL because these product-layer gate helpers do not exist yet.

**Step 3: Implement minimal gate helpers**
- Add deterministic helpers for gate evaluation in a renderer/domain module.
- Keep security enforcement in main process; only expose decision/state helpers here.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/agent/orchestrator/taskSessionGates.test.ts`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/agent/orchestrator/taskSessionGates.test.ts src/renderer/agent
git commit -m "feat: add task session gate evaluation helpers"
```

### Task 7: Add security integration coverage for trust and workspace behavior

**Files:**
- Modify: `tests/main/security/isolatedWorkspace.test.ts`
- Modify: `tests/main/security/secureTerminal.test.ts`
- Modify: `tests/main/security/secureFile.test.ts`

**Step 1: Write failing integration cases**
- Add cases proving:
  - task-level execution target uses accessible isolated roots
  - secure terminal still enforces boundaries for isolated workspaces
  - secure file writes remain blocked outside workspace roots even for task-driven UI

**Step 2: Run targeted tests to verify they fail**
- Run: `npm test -- tests/main/security/isolatedWorkspace.test.ts tests/main/security/secureTerminal.test.ts tests/main/security/secureFile.test.ts`
- Expected: FAIL or require implementation adjustments.

**Step 3: Implement minimal integration glue**
- Only add the minimal glue required for the new task-session abstractions to use existing main-process security safely.

**Step 4: Run targeted tests to verify they pass**
- Run: `npm test -- tests/main/security/isolatedWorkspace.test.ts tests/main/security/secureTerminal.test.ts tests/main/security/secureFile.test.ts`
- Expected: PASS.

**Step 5: Commit**

```bash
git add tests/main/security src/main/security src/renderer/agent
git commit -m "test: cover task-driven security gate integration"
```

### Task 8: Verify the full first-phase hybrid flow

**Files:**
- Modify: files from prior tasks as needed
- Test: targeted Vitest suite and full app verification

**Step 1: Run focused renderer and domain verification**
- Run:
  - `npx vitest run tests/agent/store/taskSessionModel.test.ts`
  - `npx vitest run tests/agent/store/taskSessionStore.test.ts`
  - `npx vitest run tests/renderer/orchestrator/PatchBatchPanel.test.tsx`
  - `npx vitest run tests/renderer/orchestrator/ExecutionConsolePanel.test.tsx`
  - `npx vitest run tests/renderer/panels/ComposerTaskSessionEntry.test.tsx`
  - `npx vitest run tests/agent/orchestrator/taskSessionGates.test.ts`

**Step 2: Run broader verification**
- Run: `npm test`
- Run: `npx tsc --noEmit`
- Run: `npm run build`

**Step 3: Review output**
- Confirm the new task-first hybrid flow does not regress orchestrator, proposal review, or security behavior.
- Fix only issues caused by this feature set.

**Step 4: Commit final integration pass**

```bash
git add src tests
git commit -m "feat: ship first-phase hybrid agent ide flow"
```
