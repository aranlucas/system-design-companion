# System Design Companion

A live Excalidraw canvas that you, your interviewer, and Claude Code edit together. See [docs/design.md](docs/design.md).

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

1. Open http://localhost:5173, create a diagram (optionally from a template).
2. Add the MCP server once (use the deployed URL + `/mcp` in production):
   - Claude Code: `claude mcp add --transport http canvas http://localhost:5173/mcp`
   - Codex: `codex mcp add canvas --url http://localhost:5173/mcp`
3. Tell the agent "join <share link>", then draw together. Select things on the canvas and say "what about this?".

## Deploy (Cloudflare)

```sh
npx wrangler d1 create system-design-companion   # paste database_id into wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
pnpm deploy
```

Then `claude mcp add --transport http canvas https://<your-worker>.workers.dev/mcp` (or `codex mcp add canvas --url …/mcp`).

## Using it in the interview

- **Share / Agent**: copies the edit link for the interviewer, plus the Claude setup command and join prompt.
- **Versions**: every Claude edit is snapshotted first, so one click undoes it. You can also save named checkpoints and save a diagram as a template.
- Claude's elements are violet, and a toast says when Claude changed something.
- MCP prompts: `review_design`, `suggest_next_step`, `estimate_capacity`. Resource: `rubric://system-design`.
- In clients that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps) (Claude Desktop/web, ChatGPT, VS Code), `get_scene` also shows a hand-drawn picture of the canvas inline, with refresh, full screen (live-updating) and open-canvas buttons. Terminal clients get the usual text. The view lives in `src/view/`; `pnpm build:view` bundles it into `public/mcp-view.html`, which the worker reads via the `ASSETS` binding.

## Checks

```sh
pnpm check                    # typecheck, Oxlint, Oxfmt
pnpm test                     # vitest: scene engine, rooms, HTTP routes (97 tests)
pnpm format                   # apply Oxfmt
node scripts/scene-smoke.ts      # scene engine smoke test
```

See [docs/improvements.md](docs/improvements.md) for test coverage, findings, and
related-project research.
