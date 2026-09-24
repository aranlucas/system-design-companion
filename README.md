# System Design Companion

A live Excalidraw canvas that you, your interviewer, and Claude Code edit together. See [docs/design.md](docs/design.md).

## Run locally

```sh
npm install
npm run dev          # http://localhost:5173
```

1. Open http://localhost:5173, create a diagram (optionally from a template).
2. Run once: `claude mcp add --transport http canvas http://localhost:5173/mcp` (or the deployed URL + `/mcp`).
3. In Claude Code: "join <share link>", then draw together. Select things on the canvas and say "what about this?".

## Deploy (Cloudflare)

```sh
npx wrangler d1 create system-design-companion   # paste database_id into wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
npm run deploy
```

Then `claude mcp add --transport http canvas https://<your-worker>.workers.dev/mcp`.

## Using it in the interview

- **Share / Agent**: copies the edit link for the interviewer, plus the Claude setup command and join prompt.
- **Versions**: every Claude edit is snapshotted first, so one click undoes it. You can also save named checkpoints and save a diagram as a template.
- Claude's elements are violet, and a toast says when Claude changed something.
- MCP prompts: `review_design`, `suggest_next_step`, `estimate_capacity`. Resource: `rubric://system-design`.

## Test

```sh
npm run typecheck
node scripts/scene-smoke.ts      # scene engine smoke test
```
