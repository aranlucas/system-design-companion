# Plan 005: The sidebar interview ends with a rubric-grounded recap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 15d5dbf..HEAD -- src/app/interviewer-panel.tsx src/app/interviewer-transport.ts src/worker/rubric.ts src/worker/mcp.ts test/interviewer.test.ts e2e/interviewer.e2e.ts e2e/fixtures.ts`

## Status

- **Priority**: P2 (direction; the maintainer must clear the ROADMAP gates first, see STOP conditions)
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-keep-named-checkpoints-listed.md (so the start checkpoint stays listed)
- **Category**: direction
- **Planned at**: commit `15d5dbf`, 2026-11-11

## Why this matters

ROADMAP.md lists "A complete practice-session outcome" as its "Now" release:
"a stated goal, a chosen timebox and a final recap tied to diagram
checkpoints", with "strengths, unanswered questions and one concrete next
exercise". Its "Next shippable slice" is to "add the session recap and
next-exercise handoff around the existing interviewer, versions and rubric
capabilities". Today none of those pieces are connected:

- The sidebar interview never ends.
- The rubric is reachable only over MCP.
- The conversation is lost on reload.

## Current state

- `src/app/interviewer-panel.tsx` (432 lines):
  - State is `running`, `draft` and `pendingChange` (65–71).
  - `start` / `pause` are at 266–285, and the only controls are Start / Pause / Resume (319–325).
  - Automatic messages carry `metadata.automatic` and are hidden in the log (341).
  - Requests send `body: { model: INTERVIEW_MODEL, changes }` (177, 365–368, 401–404).
- `src/app/interviewer-transport.ts`:
  - `InterviewRequest = { model, changes }` (18–21), validated by `requestSchema` (28).
  - The fixed `INSTRUCTIONS` say "Ask ONE concise question" and "Never edit the diagram" (30–38).
  - Line 37 treats diagram content as untrusted. Keep that rule.
- `src/worker/rubric.ts`: `export const RUBRIC` (10 dimensions), imported only by
  `src/worker/mcp.ts:21` (resource at 751–758, `review_design` prompt at 760–774).
  `tsconfig.app.json` includes only `src/app`, `src/view` and `src/shared`, so the app
  cannot import from `src/worker`.
- `src/worker/index.ts:202-207`: `GET`/`POST /api/d/:id/snapshots?k=` lists and creates
  named checkpoints. The panel already has `id` and `diagramKey`.
- Tests:
  - `test/interviewer.test.ts:104-160` asserts on the request body sent through the
    ChatGPT proxy. Use it as the model for transport tests.
  - `e2e/interviewer.e2e.ts` and `e2e/fixtures.ts:115,144` mock the model and the
    interview context.
- ROADMAP constraints to honour in copy and prompt: "No hiring-quality or
  validated skill-score claims. Keep user corrections and uncertainty visible."

## Commands you will need

| Purpose   | Command                                         | Expected                                          |
| --------- | ----------------------------------------------- | ------------------------------------------------- |
| Typecheck | `pnpm typecheck`                                | exit 0                                            |
| Lint      | `pnpm lint && pnpm format:check`                | exit 0                                            |
| Unit      | `pnpm exec vitest run test/interviewer.test.ts` | pass                                              |
| E2E       | `pnpm test:e2e`                                 | pass (needs `pnpm exec e2e-web install chromium`) |
| Build     | `pnpm build`                                    | exit 0                                            |

## Scope

**In scope**:

- `src/shared/rubric.ts` (new; move `RUBRIC` here)
- `src/worker/rubric.ts` (becomes a re-export, or update the `mcp.ts` import)
- `src/app/interviewer-transport.ts` and `src/app/interviewer-panel.tsx`
- `src/app/styles.css` (only if needed)
- Tests: `test/interviewer.test.ts`, `e2e/interviewer.e2e.ts` and `e2e/fixtures.ts`

**Out of scope**:

- Server-side persistence of recaps. That is a privacy and retention decision the
  ROADMAP and `docs/openai-plugin-readiness.md` leave open.
- Any change to `src/worker/chatgpt.ts` limits or the allowed model.
- Writing the recap onto the canvas. The interviewer must never edit the diagram.

## Steps

1. Move `RUBRIC` to `src/shared/rubric.ts` and point `mcp.ts` at it.
   **Verify**: `pnpm typecheck` passes and `grep -rn "RUBRIC" src` shows one definition.
2. Transport changes:
   - Extend `InterviewRequest` with an optional `mode: "question" | "recap"` and
     optional `goal` / `checkpoints` strings. Update `requestSchema` to match.
   - When `mode === "recap"`, use `RECAP_INSTRUCTIONS`. It includes `RUBRIC` and asks
     for three headed sections: Strengths, Unanswered questions, Next exercise
     (exactly one).
   - Every point in the recap must name a component label or checkpoint name.
   - The recap gives no scores and keeps the untrusted-content rule.
     **Verify**: unit tests from the test plan pass.
3. Panel changes:
   - Before the first Start, add an optional goal input and a timebox select
     (none/30/45/60 min).
   - Start saves a named checkpoint "Interview start", plus the goal if one was given.
   - Show the remaining time in the existing `<output>`.
   - Add a "Finish and recap" button, also triggered when the timebox expires. It:
     1. pauses;
     2. saves an "Interview end" checkpoint;
     3. fetches `/snapshots` and keeps the `named` entries;
     4. sends one `mode: "recap"` message whose metadata marks it as a visible recap.
   - Render the recap with a copy button that reuses `src/app/copy-row.tsx`.
     **Verify**: `pnpm typecheck`, then `pnpm test:e2e` passes.

## Test plan

- `test/interviewer.test.ts`:
  - A recap request body contains `RUBRIC` text, the goal, the checkpoint names and
    the recap instructions.
  - A question request does not contain the recap instructions.
- `e2e/interviewer.e2e.ts`: Finish posts two named snapshots (mock them in
  `fixtures.ts`), the recap message renders, and no automatic question follows a
  later drawing change.

## Done criteria

- [ ] typecheck, lint, format, unit, e2e and build all pass
- [ ] `grep -rn "export const RUBRIC" src` finds exactly one match, in `src/shared/rubric.ts`
- [ ] No server files changed except the rubric move

## STOP conditions

- The maintainer has not confirmed both ROADMAP gates:
  - ROADMAP.md line 22: "Collect the baseline before building the first slice".
  - ROADMAP.md line 30: "Coordinate shared canvas work with system-design-chatgpt
    rather than build competing copies".
- The ChatGPT proxy rejects the longer recap instructions (size or 4xx). Report the error.

## Maintenance notes

- Keep the recap rules in one exported constant, so an MCP `session_recap` prompt
  (not yet planned; see README direction notes) can reuse them.
- The recap is tab-local, like the conversation. Persisting it requires a
  retention and deletion design first.
