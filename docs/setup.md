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
npx wrangler d1 create system-design-companion   # paste the ID into cloudflare.config.ts and the compatibility wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
npx wrangler kv namespace create OAUTH_KV         # paste the ID into both configuration files
pnpm deploy
```

Then `claude mcp add --transport http system-design https://<your-worker>.workers.dev/mcp`
(or `codex mcp add system-design --url …/mcp`).

Git-connected Workers Builds deploy `main` and build a Preview for every other branch.
Previews get their own Durable Object storage automatically but need separate D1 and R2
resources, set in the `ctx.isPreview` branch of `cloudflare.config.ts` (and the compatibility `wrangler.jsonc`):

```sh
npx wrangler d1 create system-design-companion-preview        # update the preview D1 ID in both configuration files
npx wrangler r2 bucket create system-design-companion-preview
npx wrangler kv namespace create OAUTH_KV                     # and the preview KV ID in both files
```

## Sign-in for agents

The MCP endpoint requires OAuth, so the first time an agent connects, your browser opens
a consent page and signs you in with GitHub. The canvas itself is unchanged: share links
still work, and a browser tab never needs to sign in.

Sign-in needs an OAuth app on GitHub, once per deployment:

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. **Homepage URL**: your deployment's origin.
   **Authorization callback URL**: `<origin>/github/callback`.
3. Copy the client id and secret, then set them as Worker secrets:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Until both are set, `/mcp` still answers with a token challenge but `/authorize` reports
that sign-in is not configured. The two `OAUTH_KV` namespaces (production and preview) hold
tokens and codes; nothing else moves into KV.

For local sign-in, create a separate GitHub OAuth app with callback URL
`http://localhost:5173/github/callback`, and put its credentials in an ignored `.dev.vars`:

```dotenv
GITHUB_CLIENT_ID=<local-app-client-id>
GITHUB_CLIENT_SECRET=<local-app-client-secret>
```

Every MCP call requires `mcp:read`. Tools that create diagrams, save versions, edit
content or control a browser view also require `mcp:write`; read-only tokens receive
an OAuth scope challenge before a write tool runs. A diagram share link is still
required for access to an existing board. GitHub sign-in uses public profile identity
without requesting email access, and GitHub's token is never handed to the MCP client.

Clients that connect without a browser — CI, a scripted agent — cannot complete an
interactive flow. Those still need a diagram share link for the board itself, since the
link is what authorizes access to a diagram.

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
`.cloudflare/output/v0/workers/default/assets/assets` and
`.cloudflare/output/v0/workers/default/bundle` separately (it does not recurse into directories).
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
- **Events**: `diagram.changed`, `diagram.renamed`, `diagram.checkpointed`. See
  [MCP events](#mcp-events) below.
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

## MCP events

This integration follows [OpenAI's MCP Events guide](https://developers.openai.com/plugins/build/mcp-events)
and requires protocol version `2026-07-28` for event discovery and subscriptions.

Before subscribing, configure `MCP_EVENT_CALLBACK_HOSTS` with the exact callback
hostnames operated by your trusted MCP receivers. Obtain the hostname from the
connector's callback configuration or the redacted `url` in a `host_not_allowed`
subscription error. Do not infer it from the name of the client and do not allow
user-controlled domains or wildcards. For example, for your own test receiver:

```sh
# Enter the real trusted callback hostname(s), comma-separated, at the prompt.
npx wrangler secret put MCP_EVENT_CALLBACK_HOSTS
```

For local development, add `MCP_EVENT_CALLBACK_HOSTS=<trusted-callback-host>` to
`.dev.vars`. Configure preview deployments separately. An empty list rejects all
subscriptions; ordinary MCP tools remain available.

Callbacks must use HTTPS on port 443. The server checks both A and AAAA DNS answers
before every verification or delivery, rejects non-public addresses, bounds response
sizes and timeouts, and refuses redirects. Workers `fetch` does not expose address
pinning while preserving TLS hostname verification, so this implementation requires
trusted callback operators and `global_fetch_strictly_public`. DNS preflight alone
does not guarantee protection from DNS rebinding. For arbitrary untrusted callback
hosts, use an egress service that pins validated public addresses rather than widening
the allowlist.

ChatGPT can watch a board and react to changes without anyone asking it to. It
discovers three event types and subscribes to one by naming the diagram:

| Event                  | Fires when                    | Tells the agent        |
| ---------------------- | ----------------------------- | ---------------------- |
| `diagram.changed`      | a person edits the canvas     | call `get_scene` again |
| `diagram.renamed`      | the board is renamed          | the new name           |
| `diagram.checkpointed` | someone saves a named version | a checkpoint was taken |

A useful request sounds like: _"watch this diagram and when I change it, tell me
what you would add."_ The agent subscribes with the same share link it passes to
the tools.

**The agent's own edits are not delivered** unless the subscription sets
`include_agent`. Without that, every `apply_patch` the agent made would come back
to it as an event and it would try to respond to its own work.

Delivery is signed with [Standard Webhooks](https://www.standardwebhooks.com/):
each POST carries `webhook-id`, `webhook-timestamp`, `webhook-signature` and
`X-MCP-Subscription-Id`. Payloads are deliberately small — a diagram id and a
count, never the elements themselves — and the agent re-reads the board with
`get_scene` when it needs detail. The share link is not repeated in payloads, so
the capability key stays out of the receiver's logs.

**Reliability is limited.** Events are delivered best-effort from the room, not
from a durable log, so a deployment restart can drop one and the agent will not be
told. There is no replay: a subscription cannot ask for what it missed. That is
fine for "watch this board" and wrong for anything that must not lose an event.

Subscriptions default to 12 hours and grant between 5 minutes and 7 days. Refresh
updates the expiration and signing secret without duplicating the subscription.
During signing-key rotation, deliveries carry signatures from both keys for five
minutes. Before every delivery attempt, the server rechecks the original OAuth
consent grant, diagram capability hash, subscription expiry and cancellation.
Revoking the connector's grant or deleting the diagram stops delivery; KV grant
revocation follows Cloudflare KV's consistency behavior.

To test the hosted integration in ChatGPT:

1. Connect the authenticated `/mcp` endpoint through your plugin and rescan it.
2. Confirm tools and the three events appear after discovery.
3. Ask it to watch a diagram link; check that callback verification succeeds.
4. Edit the board, rename it and save a named checkpoint. Confirm the expected
   deliveries and the response in the subscribed chat.
5. Confirm agent edits are withheld unless `include_agent: true` was requested.
6. Stop monitoring, then confirm no further events arrive. Also revoke the connector
   and confirm subscriptions stop after the revocation becomes visible.

The automated tests cover the real OAuth provider and MCP transport with fake storage
and receiver APIs. This ChatGPT test needs a deployed server, configured GitHub app and
trusted callback hostnames.

Under the hood: `events/list`, `events/subscribe` and `events/unsubscribe` are
registered by hand in `src/worker/events.ts`, because the MCP SDK has no events
support yet. Subscriptions live in D1. The endpoint is webhook-only, which is all
ChatGPT speaks today; the poll and stream modes in the draft spec are not
implemented.

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
