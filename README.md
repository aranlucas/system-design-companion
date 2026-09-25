# System Design

A live Excalidraw canvas that you, your interviewer, and Claude Code edit together. See [docs/design.md](docs/design.md).

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

1. Open http://localhost:5173, create a diagram (optionally from a template).
2. Add the MCP server once (use the deployed URL + `/mcp` in production):
   - Claude Code: `claude mcp add --transport http system-design http://localhost:5173/mcp`
   - Codex: `codex mcp add system-design --url http://localhost:5173/mcp`
3. Tell the agent "join <share link>", then draw together. Select things on the canvas and say "what about this?".

If you previously registered this server as `canvas`, remove that entry in your MCP client and add it again as `system-design` using the command above. Existing diagram links still work.

## Deploy (Cloudflare)

```sh
npx wrangler d1 create system-design-companion   # paste database_id into wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
pnpm deploy
```

Then `claude mcp add --transport http system-design https://<your-worker>.workers.dev/mcp` (or `codex mcp add system-design --url …/mcp`).

## Using it in the interview

- **Share / Agent**: copies the edit link for the interviewer, plus the Claude setup command and join prompt.
- **Rename**: click the diagram title in the bottom toolbar, or choose **Rename diagram** from the menu. The name updates in connected tabs and your recent diagrams.
- **Shape library**: editable icons for people, devices, phones, databases, servers, caches, queues, load balancers, clouds, object storage, search, auth, DNS, notifications, and schedulers. The agent gets the same drawings through `apply_patch` → `add_node` with a `kind`; there is no separate library insertion tool. Icons remain single semantic components for connecting, moving, resizing, and deleting. An explicit `shape` uses a basic shape instead. Icons have tight artwork bounds for arrow bindings; captions wrap independently below them.
- **Focus / point**: `focus_view` targets components or frames by label or ID in the most recently active open tab. `mode=focus` pans/zooms and highlights; `mode=point` shows a temporary laser-style marker without panning. Use `gesture=heart` to draw a fading heart. It does not edit the diagram or selection, and creates no version. Agent edits automatically focus and highlight the changed components in every connected tab.
- **Tidy**: fixes overlaps, near-misses in alignment and uneven spacing, and keeps connections and labels inside their endpoints’ shared frame, repairing bends that escape it. Grouped artwork moves as one piece. With a selection, only the selected frames are tidied.
- **Versions**: every Claude edit is snapshotted first with a name based on the requested change (or the edited components), so one click undoes it. You can also save named checkpoints and save a diagram as a template.
- Claude's elements are violet, and a toast says when Claude changed something.
- MCP prompts: `review_design`, `suggest_next_step`, `estimate_capacity`. Resource: `rubric://system-design`.
- In clients that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps) (Claude Desktop/web, ChatGPT, VS Code), `get_scene` also shows a hand-drawn picture of the canvas inline, with refresh, full screen (live-updating) and open-canvas buttons. Terminal clients get the usual text. The view lives in `src/view/`; `pnpm build:view` bundles it into `public/mcp-view.html`, which the worker reads via the `ASSETS` binding.

## Checks

```sh
pnpm check                    # typecheck, Oxlint, Oxfmt
pnpm test                     # vitest: scene engine, rooms, HTTP routes (99 tests)
pnpm format                   # apply Oxfmt
node scripts/scene-smoke.ts      # scene engine smoke test
```

See [docs/improvements.md](docs/improvements.md) for test coverage, findings, and
related-project research.

## Shared diagram library

All diagrams lists every saved non-template board in this deployment, including boards
created through MCP and boards that predate the library. No browser history or manual
link registration is needed. The list refreshes every ten seconds while visible and
when the window regains focus. Original share links remain valid.

This deployment is a shared workspace: anyone who can reach the app can list and open
its diagrams, including editing them. Protect the deployment with access controls if
it should be private. The library uses additional server-managed links rather than
recovering or replacing the original capability keys. Clearing browser storage does
not remove boards from the library.

The diagrams API is paginated: `GET /api/diagrams?limit=50&cursor=...` returns
`{ items, nextCursor }`. The default page size is 50, with a maximum of 100.
Pass the returned cursor unchanged; a null cursor means the final page. Ordering
uses creation time and ID, so newer inserts do not shift subsequent pages.
The homepage offers **Load more diagrams** when needed and refreshes loaded pages.

**Delete** asks for confirmation, then removes a diagram for everyone and disables
its original and library links, including active canvas connections. The authorized
API is `DELETE /api/d/:id?k=<key>`. Deletion is logical: saved data and snapshots
remain for administrative recovery; there is no restore action in the UI.
