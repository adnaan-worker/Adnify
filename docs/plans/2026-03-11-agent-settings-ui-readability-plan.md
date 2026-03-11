# Agent Settings UI Readability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve readability and responsive layout of the specialist agent settings cards without changing behavior.

**Architecture:** Keep the existing settings state and event handlers intact, and only refactor the `AgentSettings` presentation layer into clearer groups with readable labels and safer responsive classes. Add a static markup regression test to verify the new information hierarchy renders.

**Tech Stack:** React, TypeScript, TailwindCSS, Vitest, react-dom/server

---

### Task 1: Add regression test for readable specialist settings UI

**Files:**
- Create: `tests/renderer/settings/AgentSettings.test.tsx`
- Reference: `src/renderer/components/settings/tabs/AgentSettings.tsx`

**Step 1: Write the failing test**
- Render `AgentSettings` with realistic `taskTrustSettings` specialist profiles.
- Assert the output contains the new section helper copy, grouped headings, and readable labels such as `工作区可写`.

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/renderer/settings/AgentSettings.test.tsx`
- Expected: FAIL because the current component does not render the new grouped structure/copy.

**Step 3: Implement minimal UI changes**
- Refactor the specialist cards in `src/renderer/components/settings/tabs/AgentSettings.tsx`.
- Add label mapping helpers and safer responsive layout classes.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/renderer/settings/AgentSettings.test.tsx`
- Expected: PASS.

### Task 2: Verify no regressions in the wider app

**Files:**
- Modify: `src/renderer/components/settings/tabs/AgentSettings.tsx`
- Test: existing Vitest suite

**Step 1: Run relevant and full verification**
- Run: `npm test`
- Run: `npx tsc -p tsconfig.json --noEmit`
- Run: `npm run build`

**Step 2: Review output**
- Confirm no new failures tied to the settings UI.
- If build or tests fail, fix only UI-related issues introduced by this change.
