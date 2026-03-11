# Work Package Parallel Execution Design

**Goal:** Close the remaining gap in Adnify's multi-agent workflow by enabling safe parallel execution of multiple work packages inside a single execution task, with conservative proposal application back into the main workspace.

**Scope:** This design only covers parallelism within one `execution task`. It does not introduce parallel execution across multiple execution tasks, automatic commits, automatic merges, or automatic rollback patches.

---

## Confirmed Decisions

- Parallelism only applies to multiple `work package`s within the same `execution task`
- Default parallelism is `2`
- Proposal `apply` only syncs `proposal.changedFiles`
- Proposal `apply` never auto-commits and never auto-merges the whole isolated workspace
- If the main workspace changed since the work package started, application stops and creates an adjudication/conflict
- Conflict handling is conservative and file-level
- Rollback remains conservative: unapplied packages are discarded by removing isolated workspaces; applied packages still require explicit follow-up instead of automatic reverse patches

## Current Gap

Adnify already has:
- execution task and work package models
- ownership leases and queueing
- isolated workspace creation and disposal
- proposal, adjudication, rollback, and task governance UI

But two critical links are still missing:
1. the executor does not yet run a true parallel batch for non-sequential execution
2. proposal review `apply` currently updates state only and does not safely materialize approved file changes back into the main workspace

## Recommended Architecture

### 1. Parallelism model

Use **per-work-package isolated execution**.

Each work package gets its own isolated workspace, instead of sharing one task-wide workspace. This keeps execution effects separate, makes proposal review easier to reason about, and avoids hidden interference between agents.

### 2. Scheduling model

The scheduler exposes ready tasks, but the executor owns the actual parallel launch policy.

For each pass:
- pick up to `maxParallelWorkPackages = 2`
- only launch work packages whose dependencies are satisfied
- only launch work packages whose writable scopes pass exclusive ownership checks
- queued conflicting work packages remain blocked until relevant leases are released

### 3. Ownership model

Keep the existing conservative model:
- `ownershipPolicy = exclusive`
- `conflictPolicy = queue`

Important refinement:
- when a work package finishes execution and produces a proposal, its ownership lease is **not released immediately**
- the lease is only released after the proposal reaches a terminal review outcome (`applied`, `discarded`, `returned-for-rework`, or `reassigned`)

This prevents later work packages from modifying the same scope before earlier reviewed changes have been resolved.

### 4. Workspace model

Each work package records:
- `sourceWorkspacePath`
- `resolvedWorkspacePath`
- `workspaceId` / package workspace identity
- file baseline metadata for files that may later be applied back

Main-process isolated workspace APIs should support package-granular identities, not just task-level identities, so package workspaces can be created and reclaimed independently.

### 5. Proposal application model

Proposal `apply` performs a **conservative file sync**:
- only files listed in `proposal.changedFiles` are considered
- for each file, compare the current main-workspace file fingerprint against the fingerprint captured from the main workspace when the package began execution
- if any target file changed in the meantime, stop the whole apply operation and open a conflict adjudication case
- if all files are unchanged, copy the corresponding file contents from the package's isolated workspace back into the main workspace

This is intentionally not a git merge, cherry-pick, or patch-merge engine.

### 6. Conflict semantics

Conflict detection is file-level and conservative.

If any file has drifted in the main workspace since the package started:
- do not partially apply
- do not overwrite automatically
- do not attempt a 3-way merge
- create an adjudication/conflict case
- keep the proposal pending or mark it conflict-blocked until user action

### 7. Rollback semantics

- For packages that were never applied: rollback means disposing the package workspace
- For packages that were applied: keep the existing rollback proposal flow; do not add automatic reverse-patch logic in this slice

This keeps the first closed-loop implementation small and safe.

## Execution Flow

1. User creates or starts an execution task
2. Task expands into multiple work packages
3. Executor builds a candidate batch up to concurrency `2`
4. For each selected package:
   - acquire exclusive ownership for writable scopes
   - create a package-specific isolated workspace
   - snapshot baseline fingerprints for relevant files from the main workspace
   - run the agent only inside that isolated workspace
5. On package completion:
   - collect changed files
   - create handoff + proposal
   - keep ownership lease active until review outcome
6. On proposal review:
   - `apply`: perform conservative sync back to main workspace, then release lease and dispose workspace
   - `return-for-rework`: keep or recreate package state as needed, release/reassign conservatively
   - `reassign`: move control to another specialist, preserving governance state
   - `discard`: release lease and dispose workspace without applying changes
7. When blocked scopes are freed, queued packages become ready and can enter the next parallel batch

## Error Handling

- Workspace creation failure marks the package failed and releases newly acquired ownership
- Apply failure caused by filesystem errors keeps proposal unresolved and surfaces a review error
- Conflict detection opens adjudication instead of overwriting files
- Cleanup failures are logged, but execution state must remain explicit so the UI can surface stuck resources

## Testing Strategy

### Unit / service tests
- ownership queue behavior with delayed release until proposal resolution
- package-level isolated workspace create/dispose behavior
- file baseline capture and conflict detection
- conservative apply success path
- conservative apply conflict path
- parallel batch selection obeying concurrency limit and scope blocking

### Store / integration tests
- completed work package remains scope-blocking until review outcome
- applying a proposal updates work package state, releases lease, and wakes queued work
- conflict during apply opens adjudication and does not copy files
- parallel execution path runs up to two work packages without cross-overwriting state

### Regression verification
- typecheck
- full test suite
- build
- pack
- replace `/Applications/Adnify.app`
- launch / quit smoke test

## Out of Scope

- parallel execution across multiple execution tasks
- user-configurable concurrency UI in this slice
- automatic git commit / merge / cherry-pick during proposal apply
- automatic reverse patch rollback for already-applied proposals
- semantic or 3-way merge conflict resolution
