# ChatGPT Plugin Extensions experiment

The `codex/chatgpt-plugin-api` branch implements the
[Plugin Extensions API](https://developers.openai.com/plugins/build/extensions)
with `@openai/mcp-extensions` 0.1.0. It adds both a sidebar app (`global`
entrypoint) and a conversation panel (`thread` entrypoint). Both open the full
collaborative Excalidraw editor with a diagram chooser.

## Dependency boundary

The released Extensions SDK requires `@modelcontextprotocol/ext-apps` ^1.7.5
and `@modelcontextprotocol/sdk` ^1.29.0. This branch downgrades the widget's
MCP Apps dependency from 2.0.0 to 1.7.5 and installs MCP SDK 1.29.0 alongside
`@openai/mcp-extensions` 0.1.0.

The backend retains `@modelcontextprotocol/server` 2.1.0, protocol version
`2026-07-28`, OAuth, and MCP Events. It registers the extension tool/resource
metadata directly through the v2 server and checks it against the released
Extensions SDK's schemas in tests. The older server helper expects a v1 server;
it is not instantiated. The browser uses `new OpenAIExtensions(app)` on the
standard MCP Apps bridge for deep links and model context.

The first commit on this branch tried `window.openai` compatibility APIs. The
current implementation replaces that adapter with the Extensions SDK.

## What changes

- App-only `open_canvas` advertises both entrypoints under `openai/ui` and has
  no required arguments. Its launch result contains the signed-in user's first
  page of diagrams and can include a validated active share link and name.
- App-only `list_diagrams` provides owner-scoped refresh and pagination. The
  workspace consumes the initial launch result without calling the opener again.
- The workspace offers a chooser and a shared-link form. Shared links are
  verified through `join_session` before navigation. The embedded editor is
  restricted to the deployment's exact origin by validation and `ui.csp.frameDomains`.
- The editor keeps its existing drawing, collaboration, versions, share, and
  component-library controls. **All diagrams** returns to the workspace chooser.
  **Use selection in chat** is a native Excalidraw `MainMenu.Item`; it updates
  model context with the active diagram and selected element IDs without sending
  a chat message when the host supports context updates. Opening a diagram also
  updates model context. Hosts without context support can still use the editor.
- Host theme changes reach the editor through origin- and source-checked
  messages. The workspace reads deep links through the Extensions SDK and uses
  its model-context API when advertised, falling back to the shared MCP Apps
  context API otherwise.
- `get_scene` retains the inline SVG preview, refresh, fullscreen polling, and
  **Open canvas** navigation. It also reads Extensions deep links. Images and
  embeds remain placeholders in that preview; the workspace uses the full editor.

The chooser lives outside the drawing surface because Excalidraw's library
contains reusable drawing components, not the server's saved diagrams. Canvas
actions use Excalidraw's existing menu and welcome-screen components.

The workspace declares only fullscreen display mode, which the host uses for
sidebar and conversation-panel placements. The preview supports inline and
fullscreen. Their resource cache keys are
`ui://system-design-canvas/workspace-v1.html` and
`ui://system-design-canvas/diagram-extensions-v1.html`. Both use the standard
`text/html;profile=mcp-app` MIME type and self-contained HTML bundles generated
by `pnpm build:view`.

## Try it

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm check`, `pnpm test`, and `pnpm check:bundle`.
3. Deploy this branch to a test deployment with the GitHub OAuth setup described
   in [setup.md](setup.md). Connect its HTTPS `/mcp` endpoint to a development
   plugin and rescan tools using the
   [connect and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
   A local branch does not update an installed plugin's deployed endpoint.
4. Open **System Design** from the ChatGPT sidebar and from a conversation's
   panel. Confirm both show the chooser, load your diagrams, paginate, and allow
   a valid shared link. An empty library should still offer the shared-link form.
5. Open a board and draw in it. Make an agent edit in chat and a browser edit on
   the same board; verify all three views synchronize. Select components and use
   **Use selection in chat**, then ask ChatGPT to work on those components.
6. Check light/dark themes, narrow layouts, keyboard access, clipboard actions,
   **All diagrams**, and library refresh while a shared board is active. Test an
   invalid or revoked link and a link from a different deployment.
7. Check the inline preview and a deep link containing a URL-encoded `diagram`
   query parameter. Verify MCP Events through the same endpoint; they still
   require MCP `2026-07-28` and configured callback hosts.

Repository tests cover extension metadata, owner isolation, capability checks,
the released SDK's deep-link handling, and editor message boundaries. Local
browser validation used a simulated MCP Apps host with the built workspace and
a local Cloudflare Worker/editor. It covered launch-result reuse, deep links,
theme changes, library refresh/pagination, drawing, cross-tab synchronization,
selection context, the portable context fallback, invalid share links, message
source checks, and a 390px viewport.

A deployed development plugin in ChatGPT is still needed to confirm entrypoint
discovery, account availability, OAuth, and nested-frame CSP enforcement. No
production deployment is part of this branch.
