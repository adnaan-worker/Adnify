# Work Package Parallel Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable safe parallel execution of multiple work packages inside a single execution task and make approved proposals apply their changed files back into the main workspace conservatively.

**Architecture:** Keep the existing task governance, ownership queue, and isolated workspace model, but extend them to package-granular execution. Add package-specific workspace tracking, main-workspace baseline capture, conservative proposal application, and a real parallel batch path in the executor. Preserve exclusive scope ownership, queueing, and adjudication-first conflict handling.

**Tech Stack:** Electron, React, Zustand, TypeScript, Vitest

---

### Task 1: Extend isolated workspace identity to package scope

**Files:**
- Modify: `src/main/security/isolatedWorkspace.ts`
- Modify: `src/main/security/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/services/electronAPI.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Test: `tests/main/security/isolatedWorkspace.test.ts`

**Step 1: Write the failing test**

Add tests proving:
- isolated workspaces can be tracked with independent package-level identities
- disposing one package workspace does not remove another package workspace under the same task
- bulk cleanup still removes every remaining package workspace safely

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: FAIL because the registry is keyed only by `taskId`.

**Step 3: Write minimal implementation**

Change the isolated workspace registry and IPC payloads so they accept a package-scoped key such as `taskId + workPackageId` or a dedicated workspace owner id. Keep the API backward-compatible where practical, but ensure package workspaces can be created and disposed independently.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: PASS.

### Task 2: Track package workspace state and baseline metadata

**Files:**
- Modify: `src/renderer/agent/types/taskExecution.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/agent/services/executionWorkspaceService.ts`
- Test: `tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Test: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- each work package stores its own isolated workspace identity and resolved workspace path
- package execution captures baseline metadata for candidate changed files
- package cleanup only disposes that package workspace

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: FAIL because package-level workspace state and baselines are not modeled yet.

**Step 3: Write minimal implementation**

Extend work package state to track:
- package workspace owner id
- package resolved workspace path
- baseline file metadata map
- apply / conflict status where needed

Update execution workspace helpers to prepare and dispose workspaces per work package.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: PASS.

### Task 3: Delay ownership release until proposal resolution

**Files:**
- Modify: `src/renderer/agent/services/ownershipRegistryService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Test: `tests/agent/services/ownershipRegistryService.test.ts`
- Test: `tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- a completed work package that produced a proposal still blocks conflicting scopes
- queued work does not wake until the proposal reaches a terminal review outcome
- proposal discard/apply resolution wakes the next queued package in FIFO order

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/services/ownershipRegistryService.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts`
Expected: FAIL because ownership is currently released at completion time.

**Step 3: Write minimal implementation**

Move lease release out of work-package completion and into proposal resolution / terminal review handling. Preserve queue summaries and wake-up behavior.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/services/ownershipRegistryService.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts`
Expected: PASS.

### Task 4: Add conservative proposal application service

**Files:**
- Create: `src/renderer/agent/services/proposalApplyService.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Test: `tests/agent/services/proposalApplyService.test.ts`
- Test: `tests/agent/orchestrator/workPackageProposalReview.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:
- `apply` copies only `proposal.changedFiles` from the package workspace back to the main workspace
- if any target file changed since the package baseline snapshot, the apply is rejected and no files are copied
- successful apply releases ownership, updates work package / proposal state, and disposes the package workspace

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/services/proposalApplyService.test.ts tests/agent/orchestrator/workPackageProposalReview.test.tsx`
Expected: FAIL because proposal apply currently only mutates in-memory status.

**Step 3: Write minimal implementation**

Implement a conservative apply service that:
- reads baseline metadata captured at package start
- re-checks main-workspace file metadata before applying
- copies only approved files back to the main workspace
- aborts the entire apply on the first conflict
- reports conflicts through adjudication-friendly state

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/services/proposalApplyService.test.ts tests/agent/orchestrator/workPackageProposalReview.test.tsx`
Expected: PASS.

### Task 5: Add proposal conflict adjudication path

**Files:**
- Modify: `src/renderer/agent/services/coordinatorService.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Modify: `src/renderer/components/orchestrator/AdjudicationPanel.tsx`
- Test: `tests/agent/services/coordinatorAdjudication.test.ts`
- Test: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing tests**

Add tests proving:
- main-workspace drift during apply creates an adjudication case with a dedicated conflict reason
- proposal status remains unresolved / blocked instead of silently becoming applied
- the task governance state reflects manual review being required

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/services/coordinatorAdjudication.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: FAIL because proposal apply conflicts are not modeled yet.

**Step 3: Write minimal implementation**

Add a dedicated conflict adjudication trigger and resolution path for proposal application failures caused by main-workspace drift.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/services/coordinatorAdjudication.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
Expected: PASS.

### Task 6: Connect true parallel batch execution

**Files:**
- Modify: `src/renderer/agent/orchestrator/ExecutionScheduler.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Test: `tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Test: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:
- non-sequential execution launches up to two ready work packages in one batch
- scope conflicts still queue correctly even when concurrency is available
- completion of one running package can allow another queued package to enter the next batch

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
Expected: FAIL because the executor loop currently only handles sequential selection.

**Step 3: Write minimal implementation**

Update the executor loop to:
- ask the scheduler for a parallel batch in non-sequential mode
- launch tasks concurrently up to the configured limit
- wait for the batch to settle
- refresh plan/task state between batches
- preserve existing governance, circuit-breaker, and cleanup behavior

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
Expected: PASS.

### Task 7: Surface apply / conflict states in the review UI

**Files:**
- Modify: `src/renderer/components/orchestrator/ChangeProposalPanel.tsx`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Test: `tests/agent/orchestrator/workPackageProposalReview.test.tsx`

**Step 1: Write the failing test**

Add a UI test proving the proposal review panel can display:
- apply-in-progress or resolved state
- conflict-blocked state
- follow-up actions that match conservative adjudication

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/orchestrator/workPackageProposalReview.test.tsx`
Expected: FAIL because the UI only reflects a simple status mutation today.

**Step 3: Write minimal implementation**

Update the review panels so proposal application results and conflict/adjudication states are visible and consistent with store state.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/orchestrator/workPackageProposalReview.test.tsx`
Expected: PASS.

### Task 8: Full verification and smoke validation

**Files:**
- No code changes unless verification finds regressions

**Step 1: Run focused tests**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts tests/agent/services/ownershipRegistryService.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/services/proposalApplyService.test.ts tests/agent/orchestrator/workPackageProposalReview.test.tsx`
Expected: PASS.

**Step 2: Run typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

**Step 3: Run full tests**

Run: `npm test`
Expected: PASS.

**Step 4: Run build**

Run: `npm run build`
Expected: PASS.

**Step 5: Pack and smoke test**

Run: `npm run pack`
Expected: PASS.

Replace `release/mac-arm64/Adnify.app` into `/Applications/Adnify.app`, launch it, verify no new crash report, then quit and confirm Adnify processes are reclaimed.
