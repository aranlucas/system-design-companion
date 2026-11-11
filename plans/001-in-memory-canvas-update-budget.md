# Plan 001: Normal drawing never disconnects a canvas tab, and canvas updates stop waiting on D1

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 15d5dbf..HEAD -- src/worker/room.ts src/worker/request-limits.ts src/app/canvas.tsx test/room.test.ts docs/design.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED (it changes an abuse limit)
- **Depends on**: none
- **Category**: bug (also perf)
- **Planned at**: commit `15d5dbf`, 2026-11-11

## Why this matters

The canvas tab sends local changes at most every 60 ms while anything changes:
dragging, resizing, freehand drawing. Each pointer move bumps the element
`version`, so the tab sends about 16 updates/s. The room admits only **240 updates
per minute per board, shared by every tab**, before it closes the sender's socket
with 1013. One person dragging or sketching for about 15 s in a minute, or
several collaborators drawing together sooner, gets disconnected. The client
reconnects, receives `init`, re-sends, and is closed again until the minute window
rolls over: "Offline, reconnecting…" in the middle of an interview, while peers
stop seeing edits.

The limit is also checked with two D1 round trips (`CREATE TABLE IF NOT EXISTS`
plus an upsert) **before every canvas message is applied**. That adds latency to
every stroke, D1 cost on every update, and a dependency: a D1 failure closes
every editing socket even though the room's scene lives in its own SQLite.

A Durable Object is the single instance for its board, so an in-memory budget
is exact. D1 is unnecessary here.

## Current state

- `src/worker/room.ts:438-489` handles the `update` branch of `webSocketMessage`:

  ```ts
  case "update": {
    try {
      await takeBudget(this.env, `board-update:${this.diagramId}`, 240);
    } catch {
      ws.close(1013, "Too many canvas updates");
      return;
    }
    if (this.deleted) {
      return;
    }
    … // winners by version/nonce, persist, broadcast, emit
  ```

  `this.deleted` is re-checked only because of the `await`.

- `src/worker/request-limits.ts:56-72` defines `takeBudget`. It is a D1 fixed window that is
  correct for the stateless Worker routes (`index.ts:148`, `mcp.ts:37`, `store.ts:243`,
  `browser-auth.ts:80`, `index.ts:81`). Keep those callers unchanged.
- `src/app/canvas.tsx:955-957` throttles sends to 60 ms:
  `pendingSend.current ??= window.setTimeout(flush, 60);`
- `canvas.tsx:591-594` makes partysocket reconnect on any close except 1008. 1013
  therefore reconnects, and `init` then makes `flush` re-send (`:639-664`).
- Existing tests drive `room.webSocketMessage(ws, JSON.stringify(...))` with
  `makeWs()` and `makeRoomCtx()` from `test/helpers/fakes.ts`. Close codes are observed with
  `ws.close = vi.fn()` (`test/room.test.ts:79-83`, `:374-383`). No test covers 1013 or
  the update budget today.
- Convention: room methods that don't await return `promiseResult(() => …)`
  (`fetch`, `webSocketClose`, `info`) rather than being `async` without an `await`.
- CI caveat (`.github/workflows/ci.yml:54-74`): one step swaps `room.ts` (and four
  other files) back to commit `6a6c919`. It then runs only tests whose names contain
  "reliability regression", and asserts exactly 8 failures. **Do not** name new tests
  "reliability regression". Do not make `test/room.test.ts` import a new export from
  `room.ts`, because that file is replaced in that step. Put new exports in
  `request-limits.ts`, which isn't swapped.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
| --------- | ---------------------------------------- | ------------------- |
| Install   | `pnpm install --frozen-lockfile`         | exit 0              |
| Typecheck | `pnpm typecheck`                         | exit 0              |
| Lint      | `pnpm lint && pnpm format:check`         | exit 0              |
| Focused   | `pnpm exec vitest run test/room.test.ts` | all pass            |
| All tests | `pnpm test`                              | all pass            |
| Build     | `pnpm build`                             | exit 0              |

## Scope

**In scope**:

- `src/worker/request-limits.ts`: add an in-memory token bucket and its rate constants.
- `src/worker/room.ts`: the `update` branch of `webSocketMessage`, plus new private fields.
- `test/room.test.ts`: new tests.
- `docs/design.md`: one sentence on the canvas update limit, in "Collaboration and edits".

**Out of scope**:

- `takeBudget` and its other callers. The stateless Worker routes need the D1 window.
- The client send cadence in `canvas.tsx`. It is the contract the server must accept.
- Event coalescing for `diagram.changed`: a separate finding (perf), not this plan.
- The close-code semantics of 1008 (plan 003).

## Steps

### Step 1: Add the token bucket next to the other request limits

In `src/worker/request-limits.ts`, export:

- `UpdateRate = { perSecond: number; burst: number }`;
- `SOCKET_UPDATE_RATE = { perSecond: 20, burst: 100 }` (the client sends at most about 16.7/s);
- `ROOM_UPDATE_RATE = { perSecond: 60, burst: 300 }` (a board-wide ceiling, so many
  sockets opened from one link can't multiply the allowance without limit);
- a small `TokenBucket` class whose `take(now = Date.now()): boolean` refills
  continuously up to `burst` and spends one token.

Document why it is in memory: one Durable Object per board makes the count exact,
and it adds no I/O per message.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Use it in the room

In `room.ts`, add two private fields: `roomUpdates = new TokenBucket(ROOM_UPDATE_RATE)`
and `socketUpdates = new WeakMap<WebSocket, TokenBucket>()`. The WeakMap resets after
hibernation, which only happens when the board is idle, so a full bucket is then correct.

In the `update` branch:

1. Get or create the socket bucket.
2. If `!socketBucket.take(now) || !this.roomUpdates.take(now)`, call
   `ws.close(1013, "Too many canvas updates")` and return. Take the socket token first,
   so that a flooding socket drains only its own bucket before it is closed.
3. Remove the `await takeBudget(...)` call and the now-redundant post-await
   `this.deleted` re-check. The check at the top of the method still applies.

`webSocketMessage` no longer awaits anything. Convert it to the
`return promiseResult(() => { … })` pattern used by `fetch`/`webSocketClose`, and
drop `takeBudget` from the import if it is unused.

**Verify**: `pnpm typecheck && pnpm lint` → exit 0, and
`pnpm exec vitest run test/room.test.ts` → existing tests pass.

### Step 3: Regression tests (in `test/room.test.ts`, new `describe("canvas update budget")`)

Use `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime` (restore with
`vi.useRealTimers()` in `afterEach`), so only the clock is faked:

1. **A tab that draws for a full minute at the client's 60 ms cadence stays
   connected.** Send 1000 updates, each with a higher `version`, advancing 60 ms between
   them. Expect `close` never called and the last version persisted (`getRaw()`).
   On the base commit this fails at update 241 with `close(1013, …)`.
2. **Two tabs drawing at the same time both stay connected** (two sockets interleaved,
   500 updates each over 30 s).
3. **A flood is still cut off.** Send 1000 updates at one instant from one socket.
   Expect `close` called with `1013`. A second socket on the same board can still
   send an update afterwards and have it persisted.
4. **Canvas edits don't depend on D1.** Replace `env.DB` with a D1 whose
   `prepare` throws (keep `waitUntil` failures from event delivery quiet with a
   `console.error` spy). Send one update. Expect no close and the element persisted
   and broadcast.
5. **The board-wide ceiling holds.** Ten sockets each send 50 updates at one instant.
   At least one is closed with 1013. This would catch a per-socket-only limit.
   (The test passes on the base commit too; it guards against losing the old
   board-wide intent.)

**Verify**: `pnpm exec vitest run test/room.test.ts` → all pass. Then temporarily
replace `src/worker/room.ts` with `git show 15d5dbf:src/worker/room.ts`, without
using `git stash`, and confirm tests 1–4 fail. On the base commit the board-wide
budget also locks the collaborator out in test 3. Restore afterwards.

### Step 4: Docs

In `docs/design.md`, "Collaboration and edits": add one sentence saying that canvas updates
are rate-limited in the room's memory, per tab and per board, with headroom above the
client's 60 ms send cadence, and that exceeding the limit closes the tab with 1013,
after which it reconnects and re-syncs.

**Verify**: `pnpm format:check` → exit 0.

### Step 5: Prove the CI baseline replay still holds

Run the CI step from `.github/workflows/ci.yml:54-74` in a scratch copy of the tree
(not your working tree): restore the 5 files from `6a6c919`, run the filtered vitest
command, and check `numFailedTests == 8`.

**Verify**: the Python assertions from the workflow pass.

## Test plan

See Step 3. The structural pattern is `"broadcasts human updates to the other tabs"`
and `"reliability regression: invalid index …"` in `test/room.test.ts`, which use
`makeEnv`, `makeRoomCtx`, `makeWs` and `ws.close = vi.fn()`.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` exit 0
- [ ] `pnpm test` passes, with 5 new tests in `test/room.test.ts`
- [ ] Tests 1–4 fail against the base `room.ts`
- [ ] `grep -n "board-update" src/` → no matches
- [ ] The CI baseline-replay assertion (Step 5) still reports exactly 8 failures
- [ ] Only in-scope files changed

## STOP conditions

- The room's `update` handling has changed so that it already avoids D1 (drift).
- The CI baseline replay no longer reports exactly 8 failures after your change.
  Report this; do not edit the workflow in this plan.
- The lint rules reject a class-based bucket and the only workaround is a rule
  disable. Report it, or use a plain object with a function.

## Maintenance notes

- If the client's send cadence in `canvas.tsx:956` is lowered (for example to 30 ms),
  revisit `SOCKET_UPDATE_RATE`. Keep at least 20% headroom over the client rate.
- In-memory state resets on hibernation and on eviction. That is acceptable for
  rate limiting, but don't reuse this bucket for anything that needs durability.
- Reviewers: check that a flood still yields 1013 (not silent drops). The client
  marks elements as synced when it sends them (`canvas.tsx:784`), so silently
  dropping updates would cause divergence until the next reconnect.
