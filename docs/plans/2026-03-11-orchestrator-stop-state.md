# Orchestrator Stop-State Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复手动停止编排执行后残留的 `executing/queued` 脏状态，保证 UI 正确回落且同一 plan 可安全重启。

**Architecture:** 在 `orchestratorSlice` 中新增原子停止回收动作，统一收敛 plan/runtime 状态；`stopPlanExecution()` 只负责调用该动作并保留现有中止与工作区清理逻辑。

**Tech Stack:** TypeScript、Zustand、Vitest。

---

### Task 1: Add failing stop-cleanup regression test

**Files:**
- Modify: `tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Modify: `src/renderer/agent/services/orchestratorExecutor.ts`
- Modify: `src/renderer/agent/store/slices/orchestratorSlice.ts`

**Step 1: Write the failing test**
- 构造一个包含 `running` plan task、`executing` work package、`queued` work package、active lease、queued item 的执行态。
- 调用 `stopPlanExecution()`。
- 断言运行态被回收到可重启状态。

**Step 2: Run the test to verify it fails**
- Run: `npm test -- tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Expected: 新增断言失败，证明当前确有停止后残留问题。

**Step 3: Implement minimal cleanup path**
- 在 `orchestratorSlice` 增加原子 cleanup action。
- 在 `stopPlanExecution()` 调用该 action。

**Step 4: Re-run targeted test**
- Run: `npm test -- tests/agent/services/orchestratorExecutorIsolation.test.ts`
- Expected: PASS。

### Task 2: Validate non-regression

**Files:**
- Modify: `tests/agent/services/orchestratorExecutorIsolation.test.ts`

**Step 1: Confirm completed/proposal states survive stop**
- 补一个或复用现有场景，确保 `proposal-ready` / `applied` 不会被错误重置。

**Step 2: Run related suite**
- Run: `npm test -- tests/agent/services/orchestratorExecutorIsolation.test.ts tests/agent/store/taskOrchestratorSlice.test.ts`
- Expected: PASS。

### Task 3: Full verification

**Files:**
- No code changes expected

**Step 1: Run project verification**
- Run: `npm test && npx tsc -p tsconfig.json --noEmit && npm run build`
- Expected: 全部通过。
