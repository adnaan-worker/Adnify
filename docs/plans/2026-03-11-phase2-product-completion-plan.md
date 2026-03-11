# Phase 2 Product Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining post-MVP product capabilities for Adnify by adding browser-aware verification, richer specialist templates, stronger verifier gating, and budget-aware model routing.

**Architecture:** Reuse the current execution task, work package, MCP, specialist profile, and proposal-review architecture. Add lightweight domain/state extensions for verification modes and routing policies, then wire them through task creation, executor behavior, and UI surfaces. Favor explicit degradation over hidden fallback.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest, existing MCP integration

---

### Task 1: Add verification mode and routing domain types

**Files:**
- Modify: `src/renderer/agent/types/taskExecution.ts`
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/shared/config/types.ts`
- Modify: `src/shared/config/settings.ts`
- Test: `tests/agent/orchestrator/taskExecutionGovernanceTypes.test.ts`
- Test: `tests/services/taskTrustSettings.test.ts`

**Step 1: Write the failing tests**
- Add tests for `verificationMode`, browser verification state, and routing policy defaults.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/orchestrator/taskExecutionGovernanceTypes.test.ts tests/services/taskTrustSettings.test.ts`
- Expected: FAIL because the new fields do not exist.

**Step 3: Write minimal implementation**
- Extend the task/work package/specialist settings domain with verification mode and routing policy fields.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 2: Expand specialist templates and composer integration

**Files:**
- Modify: `src/renderer/agent/services/taskTemplateService.ts`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskComposer.tsx`
- Modify: `src/renderer/components/orchestrator/TaskTemplatePicker.tsx`
- Test: `tests/agent/services/taskTemplateService.test.ts`
- Test: `tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`

**Step 1: Write the failing tests**
- Add tests for new templates, verification defaults, and shared template rendering.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/taskTemplateService.test.ts tests/agent/orchestrator/taskBoardExecutionComposer.test.tsx`
- Expected: FAIL because templates and template metadata are incomplete.

**Step 3: Write minimal implementation**
- Expand the template registry and remove duplicated template definitions from the composer.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 3: Add browser verification capability service

**Files:**
- Create: `src/renderer/agent/services/browserVerificationService.ts`
- Modify: `src/renderer/services/mcpService.ts`
- Test: `tests/agent/services/browserVerificationService.test.ts`

**Step 1: Write the failing test**
- Add tests for MCP browser capability detection, unavailable reasons, and verifier prompt construction.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/browserVerificationService.test.ts`
- Expected: FAIL because the service does not exist.

**Step 3: Write minimal implementation**
- Create the service and expose only the MCP state access needed for browser verification.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 4: Add model routing and budget-aware fallback

**Files:**
- Create: `src/renderer/agent/services/modelRoutingService.ts`
- Modify: `src/renderer/agent/services/llmConfigService.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Test: `tests/agent/services/modelRoutingService.test.ts`

**Step 1: Write the failing test**
- Add tests proving explicit specialist model wins, balanced routing picks a role-appropriate default, and budget-aware routing degrades under pressure.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/modelRoutingService.test.ts`
- Expected: FAIL because routing service does not exist.

**Step 3: Write minimal implementation**
- Implement routing logic and wire executor config resolution through it.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 5: Strengthen verifier flow and proposal gating

**Files:**
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/services/proposalEngineService.ts`
- Modify: `src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- Modify: `src/renderer/components/orchestrator/ChangeProposalPanel.tsx`
- Modify: `src/renderer/components/orchestrator/AdjudicationPanel.tsx`
- Test: `tests/agent/services/orchestratorExecutorGovernance.test.ts`
- Test: `tests/agent/orchestrator/workPackageProposalReview.test.tsx`

**Step 1: Write the failing tests**
- Add tests for browser verification unavailable/passed/failed states and gated proposal actions.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/agent/services/orchestratorExecutorGovernance.test.ts tests/agent/orchestrator/workPackageProposalReview.test.tsx`
- Expected: FAIL because verifier gating and browser state UI are missing.

**Step 3: Write minimal implementation**
- Wire verification mode execution and update UI summaries/actions.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 6: Add settings and final UI polish for routing and verification

**Files:**
- Modify: `src/renderer/components/settings/tabs/AgentSettings.tsx`
- Test: `tests/renderer/settings/AgentSettings.test.tsx`

**Step 1: Write the failing test**
- Add assertions for routing policy copy and verification-related specialist settings.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/settings/AgentSettings.test.tsx`
- Expected: FAIL because the new controls do not render.

**Step 3: Write minimal implementation**
- Expose routing policy and verification defaults in the settings UI using the current layout.

**Step 4: Run test to verify it passes**
- Run the same vitest command.
- Expected: PASS.

### Task 7: Final verification and app-level acceptance

**Files:**
- Modify as needed from prior tasks only

**Step 1: Run full verification**
- Run: `npm test`
- Run: `npx tsc -p tsconfig.json --noEmit`
- Run: `npm run build`
- Run: `npm run pack`

**Step 2: Replace app and smoke test**
- Replace `/Applications/Adnify.app`
- Launch and verify settings, templates, execution panel, and browser-verification UI states render without regressions.
