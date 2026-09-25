# Improvements & research

Companion to [design.md](design.md). Sources: the new `tests/` suite (`pnpm test`,
99 tests), a review of `src/worker/*.ts`, and a survey of comparable projects (Sep 2026).

## 1. What the test suite covers

| File                            | Covers                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/scene-ops.test.ts`       | Every `apply_patch` op, ref/label/id resolution, ambiguity errors, partial-batch semantics, agent vs human authorship (`customData.author` / `editedBy`), violet stroke, z-order invariants                                                  |
| `tests/scene-placement.test.ts` | All placement hints, gaps, overlap nudging, chained placement, frame inference/attach/grow, frame moves carrying children                                                                                                                    |
| `tests/scene-graph.test.ts`     | `graph()` / `graphView()`, duplicate-label `#id` display, inferred edges, sketches, selection marking, `_edgesRaw` hiding                                                                                                                    |
| `tests/scene-format.test.ts`    | `wrapText` / `measureText`, `tidy` (separation, adoption, wrapping, idempotence, never changes connections/labels/colours/count), `layout`, `addForeign`, `restoreTo`, JSON round-trip (the R2 snapshot path)                                |
| `tests/scene-tidy.test.ts`      | `tidy` binding, frame fit/shrink, groups, even spacing, push direction; no-regression metrics on templates and seeded messy diagrams                                                                                                         |
| `tests/scene-templates.test.ts` | All builtin templates apply cleanly with expected node/edge counts; tidy-stability                                                                                                                                                           |
| `tests/store-meta.test.ts`      | `parseLink` / `shareLink`, `createDiagram` → `verifyKey` round-trip, builtin + saved templates, component catalog, rubric shape                                                                                                              |
| `tests/room.test.ts`            | `DiagramRoom` on fake storage: ops layer + auto-snapshots, `tidy` / `layout`, snapshot/restore/undo, `seed`, tombstone hiding, the version/nonce merge rule, tab broadcast, presence/selection, no-tab RPC errors, end-to-end interview flow |
| `tests/http.test.ts`            | Worker routes with real rooms: create/get/rename, 403s, builtin + saved templates, snapshots/restore/tidy over HTTP, 404s, `/mcp` reachability                                                                                               |
| `tests/helpers/fakes.ts`        | In-memory D1 / R2 / DO-SQL / sockets; `cloudflare:workers` stubbed via `vitest.config.ts` alias                                                                                                                                              |

Run: `pnpm test`. The suite is typechecked, linted, and formatted by `pnpm check`; CI runs it with `pnpm test`.

## 2. Findings from writing the tests (all verified in code)

High impact:

- **Snapshots are not atomic.** `snapshot()` (`src/worker/room.ts:309`) does R2 `put`
  then D1 `insert`; a crash between them orphans a blob or a listing. D1-first (or a
  compensating delete) plus a size/schema check in `restore()` (`src/worker/room.ts:339`,
  currently blind `JSON.parse`) would close this.
- **No snapshot retention or pagination.** `listSnapshots()` caps at 30 with no offset
  (`src/worker/room.ts:330`); R2/D1 grow forever. Cap auto-snapshots per diagram and add
  `DELETE /snapshots/:id`.
- **Fixed: failed batches could change live memory before persistence succeeded.**
  `Scene` now clones its input elements, and `persist()` wraps writes in
  `transactionSync` before updating the room's map and broadcasting. Injected second-write
  failures cover agent patches and human WebSocket updates, rollback, reload, and retry.
  Correction to the original finding: Cloudflare already coalesces synchronous writes
  into an atomic implicit transaction; the explicit transaction guarantees rollback when
  its callback throws. See [Cloudflare storage semantics](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).
  Tests use fake storage; workerd crash/output-gate behavior remains outside this suite.
- **Tombstones are never collected.** `restoreTo()` only adds `isDeleted`
  (`src/worker/scene.ts:1371`); elements table and `init` payloads grow unboundedly.
- **`seed()` has no empty-check and `init()` is re-callable** (`src/worker/room.ts:351`,
  `src/worker/room.ts:97`). A retried `createDiagram` duplicates template elements.
  Guard both (`els.size > 0` / already-initialised).
- **Capability links have no rotation, revocation, or read-only tier** (`src/worker/store.ts:47`,
  `src/worker/index.ts:40`). Anyone holding a link (e.g. the interviewer) can
  delete/restore/publish templates. `saveAsTemplate` lets any link-holder spam the public
  template list (`src/worker/index.ts:70`); there is no rate limiting on
  `createDiagram` / `snapshot` / `applyPatch` either.
- **`applyPatch` accepts `"system"` at runtime but not in types.**
  `room.applyPatch(ops, author: Author)` (`src/worker/room.ts:267`) only types
  `"agent" | "human" | "template"`, yet anything non-`"agent"` already takes the
  skip-snapshot/system-origin path. The tests cast (`"system" as Author`). Either type it
  or reject it.

Medium impact:

- **`webSocketClose` peers count looks off by one** (`src/worker/room.ts:184`): it
  broadcasts `getWebSockets().length - 1`, but the closed socket is already removed when
  the handler runs. Verify against the runtime.
- **`callTab` targets only the primary tab** (`src/worker/room.ts:199`) with a 20s timeout
  and unbounded `pending` map. Broadcast the RPC to all tabs (first answer wins) and cap
  pending RPCs.
- **`get_scene(raw)` is unbounded.** One large canvas is a token blowup. Add `limit` /
  frame filter / token estimate.
- **Flaky `TS2589` in the new `render_scene` tool** (`src/worker/mcp.ts:219`): "type
  instantiation excessively deep" appeared on two `tsc` runs, then vanished with no code
  change. If it recurs, annotate that handler's return type explicitly to break the
  `registerAppTool` + zod inference loop.
- **Parallel workstream note:** `src/view/`, `src/worker/view.ts`, and the `@modelcontextprotocol/ext-apps`
  integration in `src/worker/mcp.ts` are uncommitted work in progress. The suite does not
  cover the view or `/mcp` handshake yet — see §3.

## 3. Coverage gaps (deliberate; need heavier harnesses)

- Tab-side RPC: screenshot rendering and Mermaid conversion run in the browser; only the
  no-tab error paths are tested. Needs a headless-Excalidraw harness.
- `/mcp` protocol handshake (initialize → tools/call over Streamable HTTP). Only routing
  reachability is asserted. An MCP client-in-test (or `mcp inspector` in CI) would cover it.
- Multi-tab concurrency and reconnect races; DO alarms/hibernation — needs
  `@cloudflare/vitest-pool-workers` (workerd under vitest) instead of the node fakes.
- `src/app/Canvas.tsx` (reconciliation, presence spam, reconnect UX) has no tests at all.

## 4. Comparable projects and what to borrow

Nobody owns "live human + agent co-editing _for system design interviews_". Adjacent work:

- **Official `excalidraw/excalidraw-mcp`** (`https://github.com/excalidraw/excalidraw-mcp`) —
  chat-embedded canvas via MCP Apps, one-shot prompt→diagram. Borrow: inline canvas
  rendering, camera animation while the agent draws. (The in-progress `src/view/` is
  already heading here.)
- **Community `mcp_excalidraw`** (`https://github.com/yctimlin/mcp_excalidraw`) — closest
  direct overlap: persistent canvas + ~26 tools + CLI + snapshots + screenshot-verify-fix
  loop. Borrow: the draw → screenshot → fix loop, CLI-first agent skill, byte-stable exports.
- **tldraw agent kit** (`https://tldraw.dev/starter-kits/agent`, `https://github.com/tldraw/agent-template`) —
  best architecture reference: `working` vs `reviewing` modes with different toolsets,
  dual screenshot + structured-state context, sanitize helpers. Borrow the mode system
  (candidate vs interviewer vs reviewer) before adding tools.
- **tldraw MCP App** (`https://tldraw.dev/blog/tldraw-mcp-app`) — only 3 tools
  (create/edit/delete) with state echoed back each turn. Evidence that a minimal surface is
  more reliable than a large one; keep new tools deterministic (compute server-side).
- **draw.io MCP** (`https://github.com/jgraph/drawio-mcp`) — semantic search over 10k+
  shapes plus ELK auto-layout passes. Borrow: a shape-search tool for AWS/GCP/K8s stencils
  (the current `components://catalog` is colour-only) and a post-generation layout pass.
- **Eraser.io** (`https://www.eraser.io/agent-integrations`) — diagram-as-code, Terraform /
  design-doc → architecture diagrams, MCP + per-assistant skills. Borrow: code→diagram
  warm-ups ("import this repo, sketch its architecture") and per-assistant skill packaging.
- **HelloInterview practice** (`https://www.hellointerview.com/practice/overview`) — staged
  walkthroughs with AI whiteboard feedback, but single-player. Borrow: the stage machine
  (scope → estimates → HLD → deep-dive → wrap) for a timed mock-interviewer mode.

## 5. Server roadmap (deterministic tools first)

Principle: MCP tools should compute facts the LLM cannot reliably infer; prompts stay for
judgement. Each writes back through the existing `applyPatch` path (free snapshots/tidy).

1. `compute_capacity` (pure math: QPS, storage/yr, bandwidth, shards) with `writeBack`
   into the Estimates frame — the current `estimate_capacity` prompt does arithmetic in
   chat and drifts.
2. `lint_design` (unconnected nodes, `inferred` edges, cache w/o invalidation, queue w/o
   consumer, DB w/o replica, missing read/write path) returning `{code, nodes, fix: Op[]}`
   the agent can feed straight to `apply_patch`.
3. `grade_design(level)` — deterministic scorecard over the 10 `rubric.ts` rows with
   evidence node IDs; makes every other feature measurable.
4. `gaps` + `interview://question-bank` + `drill_followups(level)` — level-calibrated
   follow-ups grounded in actual graph gaps instead of static lists.
5. `compare_options(topic, A, B)` trade-off tables written back as notes (trade-offs are
   ~25% of interview signal and currently live only in prose).
6. `trace_path(from, to)` — BFS read/write-path tracer, optionally rendered as a sequence
   diagram via the existing `import_mermaid` path.
7. `inject_failure(target, kind)` — snapshot + tint + blast-radius note, with `restore` as
   recovery; timed chaos via DO alarms.
8. Roles + timed driver + `diff_snapshots` + R2 review export (`shadow_review` that never
   touches the canvas) — the mock-interview loop; each sub-mode shippable independently.
9. Later, only with data/budget: Workers AI prose grading, Vectorize similar-design
   retrieval.

Suggested build order: §2 high-impact fixes → 1+2 → 3 → 4+5 → 6+7 → 8 → 9.

## 6. Architecture review (Sep 24, 2026)

Keep the original scope: a live canvas shared by the candidate, interviewer, and agent.
The stateless MCP adapter → per-diagram room → pure scene engine split supports that
well. Keep mutations and undo in the room so HTTP, MCP, and future in-room agents share
one implementation.

Priorities after the persistence fix:

- Protect undo: validate snapshot payloads before restore, add retention/pagination, and
  recover from partial R2/D1 failures. Reordering those writes alone cannot make two
  independent services atomic.
- Add an actual MCP initialize → tools/call test, including invalid capability links
  and a patch → read → restore round trip. HTTP reachability does not prove the agent
  can collaborate.
- Bound model-facing scene responses with frame filtering and pagination; keep the
  app's complete rendering path separate so truncation does not hide canvas elements.
- Preserve focused-tab semantics when improving RPC reliability: broadcasting a selected
  screenshot request to every tab can return a different person's view. Add bounded
  pending requests and deliberate fallback behavior.
- Then implement `compute_capacity` as pure arithmetic with explicit assumptions and
  opt-in writeback through `applyPatch`. This directly supports interview discussion;
  deterministic grading needs more evidence than component presence alone.
