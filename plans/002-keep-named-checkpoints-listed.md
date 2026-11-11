# Plan 002: Named checkpoints stay listed and restorable however many agent edits follow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 15d5dbf..HEAD -- src/worker/room.ts src/worker/database.ts src/worker/mcp.ts test/helpers/fake-d1.ts test/room.test.ts docs/design.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `15d5dbf`, 2026-11-11

## Why this matters

Versions are a headline feature ("Use **Versions** to restore an agent edit or
save a named checkpoint", README). Every agent `apply_patch`, `tidy`, `layout`,
Mermaid import and restore writes an _automatic_ snapshot, and the only
listing, which backs both the Versions panel and the MCP `list_snapshots`
tool, returns the newest 30 rows of either kind. After about 30 agent edits
(one ordinary interview) a checkpoint the user saved deliberately, such as
"baseline before scaling", drops out of the list. Restore needs the snapshot
id, so the checkpoint can no longer be restored from the UI or by an agent,
although its data still exists in R2 and D1. The room's own comment
already says automatic snapshots "would bury the ones a person deliberately
took" (it applies that reasoning only to events, not to the list). After this
plan, named checkpoints are listed independently of automatic ones.

## Current state

- `src/worker/room.ts` holds the `DiagramRoom` Durable Object. Snapshot creation is at
  lines 774–814, and the listing is at 816–824:

  ```ts
  // src/worker/room.ts:803-811
  // Only checkpoints the user asked for. Every agent edit auto-snapshots, and
  // reporting those would bury the ones a person deliberately took.
  if (kind === "named") {
    this.emit("diagram.checkpointed", { … });
  }

  // src/worker/room.ts:816-824
  async listSnapshots(limit = 30): Promise<SnapshotMeta[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT id, name, kind, created_at AS createdAt, element_count AS elements FROM snapshots WHERE diagram_id = ? ORDER BY created_at DESC LIMIT ?",
    )
      .bind(this.diagramId, limit)
      .all<SnapshotMeta>();

    return results;
  }
  ```

  Auto snapshots are taken at `room.ts:682` (agent `applyPatch`), `:713` (tidy),
  `:722` (layout), `:737` (Mermaid import) and `:834` (restore safety copy).

- Consumers (do not change their shapes):
  - `src/worker/index.ts:202`: `GET /api/d/:id/snapshots` returns `listSnapshots()` as a JSON array.
  - `src/worker/mcp.ts:589-608`: the `list_snapshots` tool, which returns `{ snapshots }`. Its description is
    `"Versions, newest first (auto = taken before each agent edit)."`
  - `src/app/canvas.tsx:1436-1589`: `VersionsPanel` renders the array in order.
- `src/worker/database.ts:37-44`: the `snapshots` table and its index
  `snapshots_by_diagram ON snapshots (diagram_id, created_at)`. The schema is created on
  first use by `ensureSchema`, and there is no migration tool. New indexes use
  `CREATE INDEX IF NOT EXISTS` inside the same `env.DB.batch([...])`.
- `test/helpers/fake-d1.ts:490-503`: the string-matching D1 fake that most tests use. It
  handles `sql.includes("FROM snapshots WHERE diagram_id = ?")` with params
  `[diagramId, limit]` (schema `snapshotListParamsSchema`, line 65).
- `test/helpers/sqlite-d1.ts`: a real in-memory SQLite D1 (`node:sqlite`). Its use with
  `d1Adapter` and `ensureSchema` is shown in `test/creation-recovery.test.ts:24-32`.
  Use it to exercise the real SQL.
- `docs/design.md`, "Collaboration and edits" section: "Listings expose the latest
  30 by default, with no pagination or automatic retention."

## Commands you will need

| Purpose   | Command                                                    | Expected on success |
| --------- | ---------------------------------------------------------- | ------------------- |
| Install   | `pnpm install --frozen-lockfile`                           | exit 0              |
| Typecheck | `pnpm typecheck`                                           | exit 0              |
| Lint      | `pnpm lint && pnpm format:check`                           | exit 0              |
| Tests     | `pnpm exec vitest run test/room.test.ts test/http.test.ts` | all pass            |
| All tests | `pnpm test`                                                | all pass (see note) |
| Build     | `pnpm build`                                               | exit 0              |

Note: on a heavily loaded machine, `test/scene-tidy.test.ts` "messy 120" can
exceed Vitest's 5 s default timeout. That is unrelated to this plan (it is listed
under "Findings considered" in plans/README.md). Confirm it also fails on the base commit before treating it as yours.

## Scope

**In scope**:

- `src/worker/room.ts`: `listSnapshots` only
- `src/worker/database.ts`: one added index
- `src/worker/mcp.ts`: the `list_snapshots` description string only
- `test/helpers/fake-d1.ts`: snapshot-list handling only
- `test/room.test.ts`: new tests
- `docs/design.md`: the one sentence about listing limits

**Out of scope**:

- Response shapes of `GET /snapshots` and `list_snapshots`: clients depend on them.
- Snapshot retention or deletion, and R2 cleanup. Changing what is stored is a
  separate product decision.
- `VersionsPanel` UI layout. The merged list still renders newest-first with its `kind` tag.

## Steps

### Step 1: List named and automatic snapshots with separate caps

In `room.ts`, replace `listSnapshots(limit = 30)` with a method that returns up
to `NAMED_SNAPSHOT_LIMIT = 50` most recent **named** snapshots plus up to
`AUTO_SNAPSHOT_LIMIT = 30` most recent **auto** snapshots, merged newest-first.
Use one parameterised statement,
`... WHERE diagram_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?`, run once
per kind with `Promise.all([...].all())`, then merge and sort by `createdAt`
descending. Do not use `DB.batch`: the test adapter
(`test/helpers/d1-adapter.ts:62-76`) returns empty `results` for batches, and
the listing does not need cross-statement atomicity.
Keep the return type `Promise<SnapshotMeta[]>`. Update the comment at 803–804 or
add a short doc comment so the shared reason ("automatic snapshots must not
bury deliberate checkpoints") is stated once.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Index the per-kind query

In `database.ts`, add
`CREATE INDEX IF NOT EXISTS snapshots_by_diagram_kind ON snapshots (diagram_id, kind, created_at)`
to the batch, after `snapshots_by_diagram`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Teach the D1 fake the new statement

In `fake-d1.ts`, change the list handler to accept params `[diagramId, kind, limit]`
(update `SnapshotListParams` / `snapshotListParamsSchema`) and filter by `kind`.

**Verify**: `pnpm exec vitest run test/room.test.ts test/http.test.ts` → all pass.

### Step 4: Regression tests

Add tests to `test/room.test.ts` in the `DiagramRoom ops layer` describe block:

1. A named checkpoint survives 31 or more later agent edits. Create a named
   snapshot, then run 31 agent `applyPatch` calls that each add a node. Expect
   `listSnapshots()` to contain the named id, and to contain exactly 30 auto entries.
   Advance `Date.now` (`vi.spyOn(Date, "now")` with an incrementing clock, restored
   afterwards) so ordering is deterministic. Restoring that named id succeeds.
2. The same assertion against **real SQLite**: build the env as in
   `test/creation-recovery.test.ts` (`SQLiteD1` plus `d1Adapter` plus `ensureSchema`), so
   the actual SQL and index are executed rather than the fake.
3. The list is ordered newest-first across both kinds.

**Verify**: `pnpm exec vitest run test/room.test.ts` → all pass. Then temporarily
restore the old `listSnapshots` body and confirm tests 1 and 2 fail.

### Step 5: Descriptions and docs

- `mcp.ts` `list_snapshots` description: say it lists named checkpoints (up to 50)
  and the 30 most recent automatic versions, newest first.
- `docs/design.md`: replace "Listings expose the latest 30 by default" with the new
  rule, and keep the "no pagination or automatic retention" caveat.

**Verify**: `pnpm lint && pnpm format:check` → exit 0.

## Test plan

See Step 4. The pattern is the existing `"snapshots restore and undo"` test in
`test/room.test.ts`, plus the SQLite env setup in `test/creation-recovery.test.ts:24-32`.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` exit 0
- [ ] `pnpm test` passes, including the new tests
- [ ] The new tests fail against the old `listSnapshots` body
- [ ] `git status` shows only in-scope files changed

## STOP conditions

- Any consumer turns out to depend on "at most 30 rows".

## Maintenance notes

- If snapshot retention is added later, it must not delete named checkpoints
  silently. Use the same kind split.
- Equal `created_at` values sort arbitrarily (as before). If that matters, add
  `rowid DESC` as a tie-breaker in a follow-up.
- Named snapshots can also be created by agents (`snapshot` MCP tool), so the
  50 cap bounds the response size against a looping agent.
