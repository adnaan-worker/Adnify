# Runtime Resource Reclamation Design

**Date:** 2026-03-11

## Goal

Reduce Adnify's runtime resource footprint without hurting active workflows by adding conservative lifecycle cleanup for long-lived background resources.

## Scope

This slice focuses on resources that are expensive or leak-prone:
- terminal processes and their in-memory records
- index worker threads
- isolated task workspaces
- debugger child processes/sockets
- app-exit cleanup orchestration

It explicitly does **not** auto-kill user-owned background dev servers in normal operation.

## Conservative Policy

### 1. Terminals
- Do not auto-kill active background terminals just because they are idle.
- Only reclaim:
  - terminal records whose underlying process has already exited
  - terminals explicitly marked disposable/task-owned in future flows
  - all terminals during app shutdown

### 2. Index Worker
- Add idle destruction after indexing/query inactivity.
- Recreate lazily on next indexing/search request.
- This is safe because the worker is an optimization layer, not the source of truth.

### 3. Isolated Workspaces
- Keep current task-level cleanup on execution stop/complete/failure.
- Add main-process bulk cleanup for orphaned isolated workspaces during app shutdown.
- Cleanup must be idempotent.

### 4. Debugger Processes
- Add a global cleanup hook that stops all active debug sessions on app shutdown.
- Ensure sockets/processes are released when a session ends.

### 5. Global Cleanup Orchestrator
- Expand the existing app shutdown cleanup path so it also triggers:
  - index service destruction
  - isolated workspace cleanup
  - debugger cleanup
- Keep cleanup centralized in main-process shutdown flow.

## Implementation Shape

### Main-process APIs
- `secureTerminal`: add stale terminal record pruning helpers
- `isolatedWorkspace`: add `cleanupAllIsolatedWorkspaces()` and registry introspection as needed
- `indexService`: add idle timer + `destroyIndexService()` into shutdown cleanup
- `debugService`: add `cleanupAllSessions()`
- `ipc/index.ts` or `main.ts`: wire cleanup calls into the existing shutdown sequence

### Runtime Behavior
- When terminal exit is observed, remove the terminal from the registry immediately.
- When index activity occurs, refresh idle deadline.
- When idle deadline expires, terminate the worker only; keep persisted index data intact.
- When app quits, perform one best-effort async cleanup pass across all resource owners.

## Safety Constraints
- No changes to user-facing task semantics beyond more reliable cleanup.
- No aggressive auto-kill for background terminals in normal runtime.
- All cleanup functions must be safe to call multiple times.
- Failures in one cleanup subsystem must not block the others.

## Testing Strategy
- Add focused tests for:
  - index service idle destruction and restart safety
  - isolated workspace bulk cleanup idempotence
  - debugger global cleanup behavior
  - conservative terminal stale-record cleanup semantics
- Then run full typecheck, tests, and build.
