# Task Governance Completion Design

**Date:** 2026-03-11

## Goal

Complete the remaining non-MVP governance capabilities for Adnify's task-first solo-agent IDE so a long-running task can be budgeted, interrupted safely, adjudicated, rolled back conservatively, and configured per specialist without destabilizing existing flows.

## Chosen Approach

Use the existing task-first architecture as the execution backbone and add four focused governance layers instead of rewriting the orchestrator:
- budget ledger and cost visualization
- adjudication flow and coordinator actions
- rollback orchestration and failure recovery
- specialist profile registry and task-time snapshots

This keeps the current `ExecutionTask`, `WorkPackage`, `TaskHandoff`, coordinator, isolated workspace, and circuit breaker features intact while closing the biggest remaining product gaps.

## Constraints

- Default to conservative behavior.
- Keep existing features working on macOS and Windows.
- Do not silently revert main-workspace files.
- Allow stronger automation only when the user explicitly loosens settings.
- Prefer additive state and UI over broad refactors.

## Architecture

### 1. Governance state on tasks

`ExecutionTask` gains four explicit governance groups:
- `budget`: limits, current usage, warnings, and trip state
- `governanceState`: active, awaiting adjudication, rollback-ready, rolled-back, completed-with-warnings
- `rollback`: rollback capability snapshot and generated rollback proposal
- `specialistProfilesSnapshot`: immutable task-start copy of specialist profile configuration

This avoids fragile boolean combinations and makes governance transitions explicit and testable.

### 2. Budget ledger

A lightweight `budgetLedgerService` tracks:
- elapsed time
- estimated tokens
- LLM calls
- command count
- verification count

Budgets exist at three layers:
- global defaults
- specialist defaults
- task overrides

The ledger emits warning and trip decisions. Trips feed the circuit breaker and open adjudication instead of allowing unbounded execution.

### 3. Adjudication flow

A new `AdjudicationCase` becomes the canonical structure for:
- out-of-scope changes
- conflicting or partial handoffs
- budget trips
- repeated no-progress loops
- failed verification
- rollback recommendation

Coordinator actions support:
- accept all
- accept partial
- return for rework
- reassign specialist
- require verification
- rollback

The first implementation is conservative: partial acceptance is file-level or work-package-level, not line-merge-level.

### 4. Rollback orchestration

A `rollbackOrchestratorService` decides what can be safely undone.

Default policy:
- isolated workspaces: auto-dispose on failure is allowed
- main workspace: generate rollback proposal, require user confirmation before file revert
- external side effects: record and warn, do not promise full automatic rollback

Rollback state is linked to adjudication so the system can recommend rollback without forcing it in risky contexts.

### 5. Specialist profile registry

Each visible specialist gets an explicit profile:
- model
- tool permissions
- network policy
- git policy
- writable scope defaults
- budget cap or multiplier
- style hints
- default validation role

Profiles live in settings and are snapshotted onto a task at creation time so in-flight execution remains stable even if settings change later.

## Runtime Flow

The final execution path becomes:
- task creation
- specialist profile snapshot resolution
- budget initialization
- workspace resolution
- work-package execution
- handoff generation
- coordinator merge gate
- verification
- complete or adjudication or rollback

If a hard budget limit, conflict, or unsafe merge occurs, the task transitions to `awaiting-adjudication` instead of continuing automatically.

## UI Shape

### Task Board and execution panel

Add governance UI to the existing task board and execution task panel:
- budget summary chips and warning states
- per-task governance state badge
- adjudication banner when a decision is required
- rollback proposal panel when rollback is recommended
- specialist roster annotated with active profile details

### Settings

Add specialist profile cards and governance defaults in settings:
- per-specialist model and permission controls
- budget defaults
- rollback and interrupt policy defaults
- conservative defaults enabled by default, with opt-out controls

## Error Handling

- One governance subsystem failing must not crash the task board.
- Budget recording failures degrade to logging, not task loss.
- Rollback proposal generation must be best-effort and preserve the original task state if proposal generation fails.
- Adjudication cases must remain visible even if the original execution step already stopped.

## Testing Strategy

Add focused tests for:
- budget accumulation and hard-limit trips
- adjudication case creation and coordinator actions
- rollback proposal generation and environment-specific behavior
- specialist profile normalization, persistence, and task snapshots
- task board rendering of governance state
- executor integration paths for trip, adjudication, rollback, and recovery

Then run typecheck, full tests, build, and a local smoke test.

## Delivery Order

1. Add governance domain types and settings normalization.
2. Add budget ledger and task cost visualization.
3. Add adjudication cases and coordinator decision flow.
4. Add rollback proposal and conservative recovery behavior.
5. Add specialist profile settings and task snapshots.
6. Wire executor integration and run full verification.
