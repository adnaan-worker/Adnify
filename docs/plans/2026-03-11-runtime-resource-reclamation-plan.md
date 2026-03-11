# Runtime Resource Reclamation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add conservative runtime resource reclamation so Adnify frees leaked or idle background resources without killing user-owned background workflows.

**Architecture:** Extend existing lifecycle owners instead of inventing a new manager. Keep cleanup logic close to each subsystem, then call each subsystem from the existing main-process shutdown sequence. Runtime reclamation is conservative: auto-destroy only safe resources such as stale terminal records, idle index workers, task-owned isolated workspaces, and debugger sessions.

**Tech Stack:** Electron, TypeScript, Node child processes, worker_threads, Vitest

---

### Task 1: Add isolated workspace bulk cleanup

**Files:**
- Modify: `src/main/security/isolatedWorkspace.ts`
- Modify: `src/main/security/index.ts`
- Test: `tests/main/security/isolatedWorkspace.test.ts`

**Step 1: Write the failing test**

Add tests proving:
- repeated dispose is safe
- bulk cleanup succeeds when registry contains multiple task workspaces
- bulk cleanup is safe when the registry is already empty

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: FAIL because bulk cleanup is not implemented.

**Step 3: Write minimal implementation**

Add a `cleanupAllIsolatedWorkspaces()` helper that iterates the registry, disposes each record, and never throws on already-clean states.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts`
Expected: PASS.

### Task 2: Add conservative terminal stale-record cleanup

**Files:**
- Modify: `src/main/security/secureTerminal.ts`
- Test: `tests/main/security/secureTerminalCleanup.test.ts`

**Step 1: Write the failing test**

Add tests proving:
- a terminal is removed from the registry after exit
- stale terminal records can be pruned without killing active terminals
- global cleanup still kills all tracked terminals on shutdown

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/security/secureTerminalCleanup.test.ts`
Expected: FAIL because the stale cleanup helper does not exist.

**Step 3: Write minimal implementation**

Extract small registry helpers, remove terminal records on exit, and add a prune function that only removes already-dead entries.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/security/secureTerminalCleanup.test.ts`
Expected: PASS.

### Task 3: Add idle index worker reclamation

**Files:**
- Modify: `src/main/indexing/indexService.ts`
- Test: `tests/main/indexing/indexServiceCleanup.test.ts`

**Step 1: Write the failing test**

Add tests proving:
- worker idle timeout destroys the worker
- new index activity refreshes the idle timer
- later activity can recreate worker-backed indexing safely

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/indexing/indexServiceCleanup.test.ts`
Expected: FAIL because idle cleanup is not implemented.

**Step 3: Write minimal implementation**

Track last worker activity, schedule idle destroy for the worker only, and reinitialize lazily when semantic work resumes.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/indexing/indexServiceCleanup.test.ts`
Expected: PASS.

### Task 4: Add debugger global cleanup

**Files:**
- Modify: `src/main/services/debugger/DebugService.ts`
- Test: `tests/main/debugger/debugServiceCleanup.test.ts`

**Step 1: Write the failing test**

Add a test proving `cleanupAllSessions()` stops active sessions and clears internal maps.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/debugger/debugServiceCleanup.test.ts`
Expected: FAIL because global cleanup does not exist.

**Step 3: Write minimal implementation**

Add `cleanupAllSessions()` that loops through active sessions and calls the existing stop path.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/debugger/debugServiceCleanup.test.ts`
Expected: PASS.

### Task 5: Wire shutdown cleanup orchestration

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/security/index.ts`
- Modify: `src/main/indexing/indexService.ts`
- Modify: `src/main/services/debugger/DebugService.ts`

**Step 1: Write the failing test**

If a direct unit test is practical, add a focused cleanup orchestrator test; otherwise verify via subsystem tests and a narrow integration-style main cleanup test.

**Step 2: Run test to verify it fails**

Run: targeted vitest command for the new cleanup test if added.
Expected: FAIL until orchestration calls are wired.

**Step 3: Write minimal implementation**

Extend the existing global cleanup flow so app shutdown also destroys index services, cleans isolated workspaces, and stops debugger sessions.

**Step 4: Run test to verify it passes**

Run: targeted vitest command for cleanup orchestration.
Expected: PASS.

### Task 6: Full verification before handoff

**Files:**
- No code changes unless verification finds regressions

**Step 1: Run focused cleanup tests**

Run: `npx vitest run tests/main/security/isolatedWorkspace.test.ts tests/main/security/secureTerminalCleanup.test.ts tests/main/indexing/indexServiceCleanup.test.ts tests/main/debugger/debugServiceCleanup.test.ts`
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
