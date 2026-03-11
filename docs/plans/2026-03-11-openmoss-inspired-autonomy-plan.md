# OpenMOSS-Inspired Autonomy Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local-first autonomy layer to Adnify so long-running tasks can self-advance, self-diagnose, recover conservatively, and remain visible and interruptible inside the existing desktop IDE.

**Architecture:** Reuse the existing execution task, work package, proposal, rollback, and isolated-workspace architecture. Add autonomy-specific state, heartbeat snapshots, patrol/recovery services, and diagnosis UI without introducing a server-side orchestration platform. Keep safety defaults on and route every automatic action through existing governance boundaries.

**Tech Stack:** Electron, React, TypeScript, Zustand, existing orchestrator services, Vitest

---

### Task 1: Add autonomy and patrol domain state

**Files:**
- Modify: `src/renderer/agent/orchestrator/types.ts`
- Modify: `src/renderer/agent/types/taskExecution.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Test: `tests/agent/orchestrator/taskExecutionTypes.test.ts`
- Test: `tests/agent/store/taskOrchestratorSlice.test.ts`

**Step 1: Write the failing tests**
- Add tests for autonomy mode, patrol state, heartbeat metadata, and recovery checkpoint defaults.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/orchestrator/taskExecutionTypes.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
- Expected: FAIL because autonomy fields and defaults do not exist.

**Step 3: Write minimal implementation**
- Extend execution task and work package domain state with autonomy mode, patrol status, heartbeat snapshot, last-progress metadata, and recovery checkpoint placeholders.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 2: Add execution heartbeat snapshot service

**Files:**
- Create: `src/renderer/agent/services/executionHeartbeatService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/components/orchestrator/workPackageRuntime.ts`
- Test: `tests/agent/services/executionHeartbeatService.test.ts`
- Test: `tests/agent/services/orchestratorExecutorStopRace.test.ts`

**Step 1: Write the failing tests**
- Add tests proving heartbeat timestamps and progress snapshots update from assistant output, tool activity, and stop events.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/executionHeartbeatService.test.ts tests/agent/services/orchestratorExecutorStopRace.test.ts`
- Expected: FAIL because the heartbeat service does not exist and executor does not publish progress snapshots.

**Step 3: Write minimal implementation**
- Create a lightweight heartbeat service and wire it into work package start, tool progress, assistant output, and stop/cleanup paths.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 3: Add patrol service for stuck detection and conservative escalation

**Files:**
- Create: `src/renderer/agent/services/patrolService.ts`
- Modify: `src/renderer/agent/services/circuitBreakerService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Test: `tests/agent/services/patrolService.test.ts`
- Test: `tests/agent/services/orchestratorExecutorGovernance.test.ts`

**Step 1: Write the failing tests**
- Add tests for `active`, `silent-but-healthy`, `suspected-stuck`, and `abandoned` classification, plus escalation behavior.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/patrolService.test.ts tests/agent/services/orchestratorExecutorGovernance.test.ts`
- Expected: FAIL because patrol classification and escalation do not exist.

**Step 3: Write minimal implementation**
- Implement patrol evaluation and route suspected-stuck tasks into pause, retry, adjudication, or rollback recommendation using existing governance hooks.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 4: Add recovery checkpoint and resumable execution

**Files:**
- Create: `src/renderer/agent/services/executionRecoveryService.ts`
- Modify: `src/renderer/agent/services/executionWorkspaceService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`
- Test: `tests/agent/services/executionRecoveryService.test.ts`
- Test: `tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 1: Write the failing tests**
- Add tests for persisting recovery snapshots, rebuilding stale isolated workspaces, and resuming only unresolved work packages.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/executionRecoveryService.test.ts tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Expected: FAIL because recovery checkpoints and resume logic do not exist.

**Step 3: Write minimal implementation**
- Persist conservative recovery metadata, rebuild invalid workspaces, and resume from the last safe package boundary instead of replaying the entire task.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 5: Add coordinator, reviewer, and patrol model settings

**Files:**
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/shared/config/types.ts`
- Modify: `src/shared/config/settings.ts`
- Modify: `src/renderer/components/settings/tabs/AgentSettings.tsx`
- Modify: `src/renderer/agent/services/modelRoutingService.ts`
- Test: `tests/renderer/settings/AgentSettings.test.tsx`
- Test: `tests/agent/services/modelRoutingService.test.ts`

**Step 1: Write the failing tests**
- Add tests for independent coordinator/reviewer/patrol model fields and their default routing behavior.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/settings/AgentSettings.test.tsx tests/agent/services/modelRoutingService.test.ts`
- Expected: FAIL because the settings and routing rules do not exist.

**Step 3: Write minimal implementation**
- Add independent model configuration fields and preserve explicit user overrides over automatic routing.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 6: Add autonomy and diagnosis UI surfaces

**Files:**
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Modify: `src/renderer/components/orchestrator/WorkPackageColumn.tsx`
- Modify: `src/renderer/components/orchestrator/HandoffDetailPanel.tsx`
- Create: `src/renderer/components/orchestrator/ExecutionDiagnosticsPanel.tsx`
- Test: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
- Test: `tests/agent/orchestrator/workPackageProposalReview.test.tsx`

**Step 1: Write the failing tests**
- Add UI tests for autonomy mode labels, patrol status, workspace path display, isolation mode display, and stuck-reason copy.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionView.test.tsx tests/agent/orchestrator/workPackageProposalReview.test.tsx`
- Expected: FAIL because diagnosis UI and autonomy indicators do not render.

**Step 3: Write minimal implementation**
- Surface heartbeat, patrol state, workspace path, isolation mode, and recovery reason in the existing execution panel and detail area.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 7: Add autonomy execution mode entry and background task list

**Files:**
- Modify: `src/renderer/components/orchestrator/ExecutionTaskComposer.tsx`
- Modify: `src/renderer/components/orchestrator/TaskTemplatePicker.tsx`
- Modify: `src/renderer/components/orchestrator/TaskBoard.tsx`
- Create: `src/renderer/components/orchestrator/AutonomyTaskList.tsx`
- Modify: `src/renderer/agent/services/taskTemplateService.ts`
- Test: `tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`
- Test: `tests/agent/orchestrator/taskBoardExecutionView.test.tsx`

**Step 1: Write the failing tests**
- Add tests for choosing autonomy execution, rendering background autonomy tasks, and preserving current safe defaults.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx tests/agent/orchestrator/taskBoardExecutionView.test.tsx`
- Expected: FAIL because autonomy mode controls and task list do not exist.

**Step 3: Write minimal implementation**
- Add a local-first autonomy entry to the composer and a lightweight background task list without changing current default execution behavior.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 8: Final verification and packaged acceptance

**Files:**
- Modify as needed from prior tasks only

**Step 1: Run targeted regression**
- Run: `npx vitest run tests/agent/services/executionHeartbeatService.test.ts tests/agent/services/patrolService.test.ts tests/agent/services/executionRecoveryService.test.ts tests/agent/services/orchestratorExecutorStopRace.test.ts tests/agent/orchestrator/taskBoardExecutionView.test.tsx tests/renderer/settings/AgentSettings.test.tsx`
- Expected: PASS.

**Step 2: Run full verification**
- Run: `npm test`
- Run: `npx tsc -p tsconfig.json --noEmit`
- Run: `npm run build`
- Run: `npm run pack`
- Expected: PASS.

**Step 3: Replace app and smoke test**
- Replace `/Applications/Adnify.app`
- Verify autonomy mode entry, patrol diagnosis, stop/restart, stale-workspace recovery, and independent model settings behave correctly.
