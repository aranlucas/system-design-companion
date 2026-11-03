# Setup

How to run, deploy and connect System Design Companion. For what it does, see the
[README](../README.md); for how it works, see [design.md](design.md).

## Run locally

```sh
pnpm install
pnpm dev          # https://system-design-companion.localhost
```

1. Configure [Auth credentials](#sign-in-for-browser-and-agents), open the origin printed by `pnpm dev`, sign in, and create a diagram (optionally from a template).
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

Resource administration and deployment use the pinned `cf` CLI. The checked-in resource IDs
belong to the existing deployment; provision your own resources and update both
configuration files before deploying a separate instance.

```sh
pnpm exec cf d1 create --name system-design-companion   # paste the ID into cloudflare.config.ts and the compatibility wrangler.jsonc if not auto-provisioned
pnpm exec cf r2 buckets create --name system-design-companion
pnpm exec cf kv namespaces create --title system-design-companion-oauth  # update OAUTH_KV in both files
pnpm run deploy
```

Then `claude mcp add --transport http system-design https://<your-worker>.workers.dev/mcp`
(or `codex mcp add system-design --url …/mcp`).

Git-connected Workers Builds deploy `main` and build a Preview for every other branch.
Previews get their own Durable Object storage automatically but need separate D1 and R2
resources, set in the `ctx.isPreview` branch of `cloudflare.config.ts` (and the compatibility `wrangler.jsonc`):

```sh
pnpm exec cf d1 create --name system-design-companion-preview        # update the preview D1 ID in both configuration files
pnpm exec cf r2 buckets create --name system-design-companion-preview
pnpm exec cf kv namespaces create --title system-design-companion-preview-oauth  # update preview OAUTH_KV in both files
```

## Sign-in for browser and agents

Browser and MCP sign-in use [Auth](https://auth.aranlucas.workers.dev/) through OIDC.
The issuer is `https://auth.aranlucas.workers.dev/api/auth`; discovery is available at
`https://auth.aranlucas.workers.dev/api/auth/.well-known/openid-configuration`.
Auth owns account sign-in; this app owns its HttpOnly session and MCP consent grants.
Shared canvas links still allow collaborators to draw without signing in.

Provision a confidential client through the service's
`/api/auth/oauth2/register` endpoint (dynamic registration is enabled), with these settings:

```json
{
  "client_name": "System Design Companion",
  "redirect_uris": ["https://<your-worker>.workers.dev/api/auth/callback"],
  "scope": "openid",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "require_pkce": true
}
```

For production, register
`https://system-design-companion.aranlucas.workers.dev/api/auth/callback` and install
the credentials as Worker secrets. Registration responses contain a private
`client_secret`; keep them out of logs and Git. The authenticated
`/api/auth/oauth2/create-client` API is also available for operator-managed clients.

Register each deployment's exact callback, including previews and local development.
For Portless, use `https://system-design-companion.localhost/api/auth/callback`
(or the branch origin printed by `pnpm dev`). Save the returned credentials in a private
JSON file with keys `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` (plus optional
`LWC_SECRET`, `MCP_EVENT_CALLBACK_HOSTS`, and `OPENAI_APPS_CHALLENGE`), then deploy
them as Worker secrets:

```sh
pnpm build
pnpm exec cf deploy --prebuilt --secrets-file /secure/path/app-auth-secrets.json
```

For local development, set `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` in the ignored
`.dev.vars`. These are app client credentials, never Auth's `BETTER_AUTH_SECRET`.
Top-level redirects and backend token exchanges need no shared-domain cookies or
cross-origin browser API calls. Without both credentials, sign-in returns 503.
`OAUTH_KV` stores browser sessions, short-lived login state, and MCP tokens and grants.

Existing GitHub/ChatGPT-owned libraries are separate from the new Auth identity.
No owners are merged by email. Existing GitHub browser sessions and MCP grants expire
or can be revoked normally; operators must explicitly migrate ownership records if needed.
Logout clears this app's session and interviewer connection. It does not sign out the
central Auth account or other apps.

MCP clients authorize interactively in a browser. Tokens do not replace a board's
share link. See [access contracts](design.md#identity-and-board-access) for scope
and ownership rules.

## Checks

Use the Node version in `.node-version` and pnpm version in `package.json`.

```sh
pnpm check        # TypeScript, Oxlint, Oxfmt
pnpm test         # Vitest with fake infrastructure / local SQLite
pnpm build        # production build, no deployment
pnpm test:e2e     # local browser journeys with network fixtures
```

On a fresh machine, the browser runner needs Chromium:
`pnpm exec e2e-web install chromium --with-deps`. E2E starts its own Vite server
with `vite.e2e.config.ts`, without Cloudflare bindings or model credentials. It
does not prove real OAuth, provider inference, or hosted MCP Apps behavior.
Traces, screenshots, and JUnit output go to ignored `.e2e/`; CI uploads them.

For bundle inspection, run `pnpm build:view`, then `pnpm exec vite build --sourcemap`.
Inspect assets and Worker bundles separately under `.cloudflare/output/v0/workers/default/`.
Run `pnpm build` afterward to return to a build without source maps.

## MCP events

This integration follows [OpenAI's MCP Events guide](https://developers.openai.com/plugins/build/mcp-events)
and requires protocol version `2026-07-28` for event discovery and subscriptions.

Before subscribing, configure `MCP_EVENT_CALLBACK_HOSTS` with the exact callback
hostnames operated by your trusted MCP receivers. Obtain the hostname from the
connector's callback configuration or the redacted `url` in a `host_not_allowed`
subscription error. Do not infer it from the name of the client and do not allow
user-controlled domains or wildcards. Add `MCP_EVENT_CALLBACK_HOSTS` (comma-separated hostnames) to the private
secrets JSON used by `cf deploy --secrets-file` in the [sign-in setup](#sign-in-for-browser-and-agents).

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

Receivers discover `diagram.changed`, `diagram.renamed`, and
`diagram.checkpointed`, then subscribe with the board share link. Agent edits are
withheld unless `include_agent` is requested. Events are best-effort with no replay;
[delivery and authorization semantics](design.md#mcp-events) describe retries,
signing-key rotation, and revocation.

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

## Sidebar interviewer

The canvas **Interviewer** action opens a docked Excalidraw sidebar. It uses
[`login-with-chatgpt`](https://github.com/opencoredev/login-with-chatgpt) for device
sign-in and subscription-backed inference, with the AI SDK for conversation and
streaming. No OpenAI API key is needed. This third-party SDK uses ChatGPT's Codex
transport; it is distinct from OpenAI's registered website identity-only sign-in.

Configure `LWC_SECRET` as a stable, private random value on each deployment. For
local development, put it in the ignored `.dev.vars` file; for deployment, add it
to the private secrets JSON passed to `cf deploy --secrets-file`. Changing it disconnects existing
ChatGPT sessions. The server refuses to enable ChatGPT login without this secret.
The SDK signs its HttpOnly session cookie and encrypts account tokens before our
D1 adapter stores them. Sessions and rate counters are shared across Workers,
expired records are removed on writes, and Disconnect deletes the session.
ChatGPT connects the interviewer to the user's plan. It does not authenticate the
homepage library or MCP clients; those use Auth. Homepage **Sign out** clears the
app session and ChatGPT connection. Sidebar **Disconnect** clears only the
ChatGPT connection.

The sidebar currently uses `gpt-5.5`; access depends on the connected account.
Response failures appear with **Retry response**.

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

## Domain verification

For OpenAI domain verification, configure `OPENAI_APPS_CHALLENGE` with the exact
portal token. `/.well-known/openai-apps-challenge` serves that token as plain text;
it returns 404 when unset. The path must reach the Worker before SPA fallback
(see `src/worker/oauth-paths.ts` and both Cloudflare configs).

[Publishing acceptance](openai-plugin-readiness.md) records outstanding release
decisions and host review scenarios; it is not a live deployment assessment.
