# Plan 003: Only a deleted board tells the tab "this diagram is no longer available"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 15d5dbf..HEAD -- src/worker/room.ts src/worker/socket-schema.ts src/app/canvas.tsx test/room.test.ts e2e/`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-in-memory-canvas-update-budget.md (both edit `webSocketMessage`; land 001 first)
- **Category**: bug
- **Planned at**: commit `15d5dbf`, 2026-11-11

## Why this matters

WebSocket close code 1008 means two different things today, and the client
treats every 1008 as "diagram deleted":

- The client stops reconnecting.
- It replaces the canvas with "This diagram is no longer available. Ask the owner
  for a new share link".
- Every later local edit stays local only.

The room also sends 1008 for _recoverable_ conditions:

- a message that fails the schema;
- reaching the 5000-element cap, which counts tombstones kept for 7 days.

One realistic trigger is an agent calling `import_mermaid` with invalid Mermaid:

1. The tab replies with `rpc_result.error` set to the parser's message.
2. That message can list every expected token and exceed the 1000-character schema limit.
3. The room closes the tab with 1008.
4. The user is told their board is gone, and the agent waits 20 s for a timeout.

## Current state

- `src/worker/room.ts`:
  - `:322-324`: `deactivate()` closes with `1008, "Diagram deleted"`. This is the correct use.
  - `:431-433`: `ws.close(1008, "Invalid canvas message")` when `socketMessageSchema.parse` throws.
  - `:456-457`: `ws.close(1008, "Diagram element limit reached")`. `this.els` includes tombstones.
- `src/worker/socket-schema.ts:54` sets `error: z.string().max(1000)` for `rpc_result` failures.
- `src/app/canvas.tsx`:
  - `:580-582`: `send({ type: "rpc_result", …, ok: false, error: errorMessage(e) })`, untruncated.
  - `:594`: `shouldReconnectOnClose: (event) => event.code !== 1008, // 1008: diagram deleted`
  - `:605-614`: on 1008, it shows `unavailableCanvasMessage()` (`:85-88`).
- Tests: `test/room.test.ts:368-395` asserts `close(1008, "Invalid canvas message")` for
  an invalid index. That test is a "reliability regression" test that the CI
  baseline replay counts. **Do not rename it.** Update only its expected close code,
  and confirm the baseline replay still fails exactly 8 times (it fails on old code at the
  persistence assertion before it reaches the close assertion; check this).

## Commands you will need

| Purpose   | Command                                  | Expected |
| --------- | ---------------------------------------- | -------- |
| Typecheck | `pnpm typecheck`                         | exit 0   |
| Lint      | `pnpm lint && pnpm format:check`         | exit 0   |
| Focused   | `pnpm exec vitest run test/room.test.ts` | pass     |
| E2E       | `pnpm test:e2e`                          | pass     |

## Scope

**In scope**: `room.ts` (close codes), `canvas.tsx` (reconnect predicate, error
truncation), `test/room.test.ts`, an e2e journey in `e2e/interviewer.e2e.ts` if needed.
**Out of scope**: changing the element cap, and counting only live elements
(record that as a follow-up).

## Steps

1. In `room.ts`, use application close codes in the 4000–4999 range:
   - `4400` for "Invalid canvas message";
   - `4413` for "Diagram element limit reached".

   Name them as constants in `src/shared/protocol.ts`, so the client and server share them.
   Keep 1008 only in `deactivate()`.
   **Verify**: `grep -n "close(1008" src/worker/room.ts` → exactly one match (in `deactivate`).

2. In `canvas.tsx`, reconnect on everything except 1008 (unchanged). For 4400 and 4413,
   don't loop-reconnect blindly:
   - 4413: show a flash explaining the limit, then reconnect, because a restore or
     delete can bring the board back under the limit.
   - 4400: reconnect.
     **Verify**: `pnpm typecheck` → exit 0.
3. In `canvas.tsx:581`, truncate the error to 1000 characters before sending.
   **Verify**: the unit or e2e test below.
4. Tests:
   - Update the existing invalid-index expectation to 4400.
   - Add a room test showing the element-cap close uses 4413.
   - Add a test that an `rpc_result` with a 2000-character error is not accepted
     by the schema, so the client must truncate. Better: extract the truncation into a
     small pure helper in `src/app/` and unit-test it.

## Done criteria

- [ ] All gates pass, including `pnpm test:e2e`
- [ ] Only `deactivate()` uses 1008
- [ ] The CI baseline replay still yields exactly 8 failures

## STOP conditions

- partysocket's `shouldReconnectOnClose` does not receive application codes
  (verify in `node_modules/partysocket`).
- The baseline-replay count changes.

## Maintenance notes

Any new server-initiated close must pick a code deliberately. 1008 means "board gone"
to the client.
