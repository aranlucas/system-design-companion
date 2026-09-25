# Setup

How to run, deploy and connect System Design Companion. For what it does, see the
[README](../README.md); for how it works, see [design.md](design.md).

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

1. Open http://localhost:5173 and create a diagram (optionally from a template).
2. Add the MCP server once (use the deployed URL + `/mcp` in production):
   - Claude Code: `claude mcp add --transport http system-design http://localhost:5173/mcp`
   - Codex: `codex mcp add system-design --url http://localhost:5173/mcp`
3. Tell the agent "join <share link>", then draw together.

If you previously registered this server as `canvas`, remove that entry in your MCP client
and add it again as `system-design` using the command above. Existing diagram links still
work.

## Deploy (Cloudflare)

```sh
npx wrangler d1 create system-design-companion   # paste database_id into wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
pnpm deploy
```

Then `claude mcp add --transport http system-design https://<your-worker>.workers.dev/mcp`
(or `codex mcp add system-design --url …/mcp`).

Git-connected Workers Builds deploy `main` and build a Preview for every other branch.
Previews get their own Durable Object storage automatically but need separate D1 and R2
resources, set in the `previews` block of `wrangler.jsonc`:

```sh
npx wrangler d1 create system-design-companion-preview        # paste its database_id into previews.d1_databases
npx wrangler r2 bucket create system-design-companion-preview
```

## Checks

```sh
pnpm check                              # typecheck, Oxlint, Oxfmt
pnpm test                               # vitest: scene engine, tidy, rooms, HTTP routes
pnpm check:bundle                       # production build + home-page and total Worker size budgets
pnpm format                             # apply Oxfmt
node scripts/scene-smoke.ts             # scene engine smoke test
node scripts/tidy-check.ts <raw.json>   # layout problems before/after tidy on a real export
```

The component library and its scene builder load only when the library sidebar opens.
Excalidraw's `updateLibrary` API imports the items, shows its loading state, and preserves
any existing library items.

For a source-map breakdown, run `pnpm build:view`, then
`pnpm exec vite build --sourcemap`. The optional
[bundle-analyzer](https://github.com/lhorie/bundle-analyzer) can inspect
`dist/client/assets`, `dist/system_design_companion`, and
`dist/system_design_companion/assets` separately (it does not recurse into directories).
Its estimates are uncompressed; `check:bundle` measures actual output bytes and gzip sizes.
Run a normal `pnpm build` afterward to return to a build without source maps.

See [improvements.md](improvements.md) for test coverage, findings, and related-project
research.

## Agent reference

- **Tools**: `join_session`, `create_diagram`, `get_scene`, `get_selection`,
  `get_screenshot`, `apply_patch`, `tidy`, `layout`, `import_mermaid`, `focus_view`,
  `snapshot` / `list_snapshots` / `restore`, `list_templates` / `save_as_template`.
- **Prompts**: `review_design`, `suggest_next_step`, `estimate_capacity`.
  **Resource**: `rubric://system-design`.
- **Components**: the agent adds library icons through `apply_patch` → `add_node` with a
  `kind`; there is no separate library insertion tool. An explicit `shape` uses a basic
  shape instead. Icons have tight artwork bounds for arrow bindings; captions wrap
  independently below them.
- **Focus / point**: `focus_view` targets components or frames by label or ID in the most
  recently active open tab. `mode=focus` pans/zooms and highlights; `mode=point` shows a
  temporary laser-style marker without panning; `gesture=heart` draws a fading heart. It
  does not edit the diagram or selection, and creates no version.
- **MCP Apps view**: in supporting clients, `get_scene` also returns an inline picture with
  refresh, full screen (live-updating) and open-canvas buttons; terminal clients get the
  usual text. The view lives in `src/view/`; `pnpm build:view` bundles it into
  `public/mcp-view.html`, which the worker reads via the `ASSETS` binding.

## Diagram library API

All diagrams lists every saved non-template board in the deployment, including boards
created through MCP and boards that predate the library. No browser history or manual
link registration is needed. The list refreshes every ten seconds while visible and when
the window regains focus. Original share links remain valid. The library uses additional
server-managed links rather than recovering or replacing the original capability keys.
Clearing browser storage does not remove boards from the library.

The diagrams API is paginated: `GET /api/diagrams?limit=50&cursor=...` returns
`{ items, nextCursor }`. The default page size is 50, with a maximum of 100. Pass the
returned cursor unchanged; a null cursor means the final page. Ordering uses creation time
and ID, so newer inserts do not shift subsequent pages. The homepage offers **Load more
diagrams** when needed and refreshes loaded pages.

**Delete** asks for confirmation, then removes a diagram for everyone and disables its
original and library links, including active canvas connections. The authorized API is
`DELETE /api/d/:id?k=<key>`. Deletion is logical: saved data and snapshots remain for
administrative recovery; there is no restore action in the UI.
