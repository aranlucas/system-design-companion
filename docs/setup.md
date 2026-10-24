# Setup

How to run, deploy and connect System Design Companion. For what it does, see the
[README](../README.md); for how it works, see [design.md](design.md).

## Run locally

```sh
pnpm install
pnpm dev          # https://system-design-companion.localhost
```

1. Open https://system-design-companion.localhost and create a diagram (optionally from a template).
2. Add the MCP server once (use the deployed URL + `/mcp` in production):
   - Claude Code: `claude mcp add --transport http system-design https://system-design-companion.localhost/mcp`
   - Codex: `codex mcp add system-design --url https://system-design-companion.localhost/mcp`
3. Tell the agent "join <share link>", then draw together.

If you previously registered this server as `canvas`, remove that entry in your MCP client
and add it again as `system-design` using the command above. Existing diagram links still
work.

### Portless

`pnpm dev` runs Vite through [Portless](https://github.com/vercel-labs/portless) (a dev
dependency); its first run may ask for `sudo` to bind port 443 and trust a local
certificate. Linked Git worktrees get a branch prefix, such as
`https://fix-ui.system-design-companion.localhost`; register that origin's `/api/auth/callback` in the
development OAuth app. Node MCP clients started outside Portless may need
`NODE_EXTRA_CA_CERTS=~/.portless/ca.pem`.

## Deploy (Cloudflare)

```sh
npx wrangler d1 create system-design-companion   # paste the ID into cloudflare.config.ts and the compatibility wrangler.jsonc if not auto-provisioned
npx wrangler r2 bucket create system-design-companion
npx wrangler kv namespace create system-design-companion-oauth  # update OAUTH_KV in both files
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
npx wrangler kv namespace create system-design-companion-preview-oauth  # update preview OAUTH_KV in both files
```

## Sign-in for agents

Browser and MCP sign-in use [Auth](https://auth.aranlucas.workers.dev/) through OIDC.
The issuer is `https://auth.aranlucas.workers.dev/api/auth`; discovery is available at
`https://auth.aranlucas.workers.dev/api/auth/.well-known/openid-configuration`.
Auth owns account sign-in; this app owns its HttpOnly session and MCP consent grants.
Shared canvas links still allow collaborators to draw without signing in.

An Auth operator must provision a confidential client through the service's
`/api/auth/oauth2/create-client` endpoint, with these settings:

```json
{
  "client_name": "System Design Companion",
  "redirect_uris": ["https://<your-worker>.workers.dev/api/auth/callback"],
  "scope": "openid",
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

Register each deployment's exact callback, including previews and local development.
For Portless, use `https://system-design-companion.localhost/api/auth/callback`
(or the branch origin printed by `pnpm dev`). Store the returned credentials as Worker secrets:

```sh
npx wrangler secret put AUTH_CLIENT_ID
npx wrangler secret put AUTH_CLIENT_SECRET
```

For local development, set `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` in the ignored
`.dev.vars`. These are app client credentials, never Auth's `BETTER_AUTH_SECRET`.
Top-level redirects and backend token exchanges need no shared-domain cookies or
cross-origin browser API calls. Without both credentials, sign-in returns 503.
`OAUTH_KV` stores browser sessions, short-lived login state, and MCP tokens and grants.

`openid-client` handles discovery, PKCE S256, state, nonce, issuer/audience/expiry
checks, and RS256 signature verification with Auth's JWKS. Only the verified subject
is saved as `auth:<sub>` (URL-encoded); upstream bearer tokens are discarded.
MCP authorization resumes at its original consent request after Auth sign-in.

Existing GitHub/ChatGPT-owned libraries are separate from the new Auth identity.
No owners are merged by email. Existing GitHub browser sessions and MCP grants expire
or can be revoked normally; operators must explicitly migrate ownership records if needed.
Logout clears this app's session and interviewer connection. It does not sign out the
central Auth account or other apps.

Every MCP call requires `mcp:read`. Tools that create diagrams, save versions, edit
content or control a browser view also require `mcp:write`; read-only tokens receive
an OAuth scope challenge before a write tool runs. A diagram share link is still
required for access to an existing board. Auth sign-in requests only the stable OIDC subject; Auth's token is never handed to the MCP client.

Clients that connect without a browser — CI, a scripted agent — cannot complete an
interactive flow. Those still need a diagram share link for the board itself, since the
link is what authorizes access to a diagram.

## Checks

```sh
pnpm check                              # typecheck, Oxlint, Oxfmt
pnpm test                               # vitest: scene engine, tidy, rooms, HTTP routes
pnpm check:bundle                       # production build + home-page and total Worker size budgets
pnpm format                             # apply Oxfmt
pnpm test test/scene-smoke.test.ts      # scene engine smoke regression
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
and receiver APIs. This ChatGPT test needs a deployed server, configured sign-in and
trusted callback hostnames.

Under the hood: `events/list`, `events/subscribe` and `events/unsubscribe` are
registered by hand in `src/worker/events.ts`, because the MCP SDK has no events
support yet. Subscriptions live in D1. The endpoint is webhook-only, which is all
ChatGPT speaks today; the poll and stream modes in the draft spec are not
implemented.

## Sidebar interviewer with your ChatGPT plan

The canvas **Interviewer** action opens a docked Excalidraw sidebar. It uses
[`login-with-chatgpt`](https://github.com/opencoredev/login-with-chatgpt) for device
sign-in and subscription-backed inference, with the AI SDK for conversation and
streaming. No OpenAI API key is needed. This third-party SDK uses ChatGPT's Codex
transport; it is distinct from OpenAI's registered website identity-only sign-in.

Configure `LWC_SECRET` as a stable, private random value on each deployment. For
local development, put it in the ignored `.dev.vars` file; for deployment, use
`pnpm exec wrangler secret put LWC_SECRET`. Changing it disconnects existing
ChatGPT sessions. The server refuses to enable ChatGPT login without this secret.
The SDK signs its HttpOnly session cookie and encrypts account tokens before our
D1 adapter stores them. Sessions and rate counters are shared across Workers,
expired records are removed on writes, and Disconnect deletes the session.
ChatGPT connects the interviewer to the user's plan. It does not authenticate the
homepage library or MCP clients; those use Auth. Homepage **Sign out** clears the
app session and ChatGPT connection. Sidebar **Disconnect** clears only the
ChatGPT connection.

The sidebar uses the fixed `gpt-5.5` model and sends requests directly through the
existing Worker responses endpoint. It does not fetch the account's model catalog;
a rejected catalog request does not determine whether inference works. Actual
response failures appear in the conversation with **Retry response**. Model access
still depends on the connected ChatGPT account.

To practice:

1. Open a board and select **Interviewer** (also available in the mobile canvas menu).
2. Select **Continue with ChatGPT**, review the SDK's consent screen, and complete
   device authorization in the OpenAI window.
3. Select **Start interview**. The interviewer uses `gpt-5.5`.
4. Draw and explain your decisions. After 2.5 seconds without an edit, the
   interviewer receives the latest semantic diagram, a change summary, and a
   bounded canvas preview when available. Automatic questions are spaced at least
   15 seconds apart and wait for the previous response to finish.
5. Answer in the sidebar, pause/resume, or disconnect. Closing the sidebar pauses
   automatic requests. The conversation stays in the current tab and resets on reload.

Pointer movement, selection, zoom and opening panels do not count as drawing
changes. Drawing while the interviewer is responding is collected for the next
turn. Requests consume the connected user's ChatGPT plan and are limited to 12
per minute per session. A plan limit or expired connection appears as a retryable
conversation error. The interviewer observes the design; it does not edit it.

The sidebar observes the existing live canvas directly. External MCP clients can
independently use the same board's `diagram.changed`, `diagram.renamed`, and
`diagram.checkpointed` events with the [AI SDK MCP Events API](https://ai-sdk.dev/docs/ai-sdk-core/mcp-events).
Configure `MCP_EVENT_CALLBACK_HOSTS` with the exact hostname of your webhook
receiver. Its private event store must persist subscriptions and signing secrets;
mount `experimental_createMCPEventWebhook` before subscribing, deduplicate event
IDs, and refresh before `refreshBefore`. Events remain best-effort with no replay.
`test/ai-sdk-mcp-events.test.ts` exercises discovery, signed verification, changes,
refresh, and unsubscribe using the actual AI SDK client and webhook handler.

## Diagram library API

**Your diagrams** lists the signed-in user's non-template boards, including
boards created through MCP with the same identity. It refreshes every ten seconds
while visible and when the window regains focus. Original share links remain valid.
Saved templates are private to their owner; builtin templates remain available.

Legacy boards without an ownership record are omitted from private libraries.
Their original links still work. An operator must explicitly assign ownership in
`diagram_owners`; signing in does not claim existing boards automatically.

The diagrams API is paginated: `GET /api/diagrams?limit=50&cursor=...` returns
`{ items, nextCursor }`. The default page size is 50, with a maximum of 100. Pass the
returned cursor unchanged; a null cursor means the final page. Ordering uses creation time
and ID, so newer inserts do not shift subsequent pages. The homepage offers **Load more
diagrams** when needed and refreshes loaded pages.

**Delete** asks for confirmation, then removes a diagram for everyone and disables its
original and library links, including active canvas connections. The authorized API is
`DELETE /api/diagrams/:id`, with an authenticated owner session and same-origin
request. The capability route `DELETE /api/d/:id?k=<key>` also requires the owner.
Deletion erases the room scene, uploaded files, saved versions, library entry,
and subscriptions. It keeps an ownership record and deletion marker so the owner
can retry incomplete cleanup. Previously saved template copies remain independent.

For OpenAI domain verification, configure `OPENAI_APPS_CHALLENGE` with the exact
portal token. `/.well-known/openai-apps-challenge` serves that token as plain text;
it returns 404 when the secret is not configured.

## Browser regression tests

Run `pnpm test:e2e` to execute the whiteboard journeys with
[`tester-army/e2e`](https://github.com/tester-army/e2e). On a fresh machine, install
Chromium with `pnpm exec e2e-web install chromium --with-deps` first. The runner
starts its own local Vite server on an available port; no model credentials are
required. Exact browser actions exercise workspace sign-in, board creation, ChatGPT interviewer consent/sign-in,
drawing-driven questions with a canvas preview, ignoring zoom, typed answers,
pause/resume, and response retries. HTTP account/model endpoints and the room
WebSocket are fixtures, so these tests consume no ChatGPT plan capacity.

`pnpm test` separately exercises the actual Worker routes, encrypted D1 sessions,
board identity isolation, and AI SDK MCP event delivery. E2E traces, screenshots
and JUnit output are written to ignored `.e2e/`; CI uploads them as artifacts.
