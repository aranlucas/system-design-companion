# ChatGPT plugin API experiment

The `codex/chatgpt-plugin-api` branch tries ChatGPT's `window.openai` API in the
existing diagram preview. It keeps `@modelcontextprotocol/server` 2.1.0,
`@modelcontextprotocol/ext-apps` 2.0.0, and protocol version `2026-07-28`.
OAuth, diagram tools, and MCP Events continue to use the existing server.

The current [OpenAI plugin reference](https://developers.openai.com/plugins/reference)
documents `window.openai` as optional extensions and compatibility aliases for
MCP Apps. Using those APIs does not itself require replacing the MCP server SDK.
OpenAI recommends the standard bridge for new portable UI; this branch
deliberately tries the ChatGPT bridge first to compare the experience.

## What changes

When `window.openai.callTool` is available, the preview uses:

- `toolInput` and `openai:set_globals` to receive the diagram link, including
  input delivered after the widget has mounted.
- `callTool("render_scene", …)` for initial loading, refresh, and fullscreen polling.
- `requestDisplayMode` for fullscreen and host globals for theme/display changes.
- `openExternal` to open the collaborative canvas, with `redirectUrl: false`
  so ChatGPT does not modify its capability URL.
- `setOpenInAppUrl` to make the host's fullscreen navigation open that canvas.
- `widgetState`/`setWidgetState` to restore the diagram after a widget remount.
  The share link stays in `privateContent`; scene data remains on the server.

Hosts without `window.openai.callTool` keep using the standard MCP Apps bridge.
Optional APIs are feature-detected. Tool failures and unsupported navigation
appear in the preview's status text.

The tools advertise both standard UI metadata and ChatGPT compatibility aliases.
`render_scene` remains app-only. The resource declares inline and fullscreen modes,
font and redirect origins, and uses the new cache key
`ui://system-design-canvas/diagram-chatgpt-v1.html` so the host can load the changed
bundle independently of a previously cached view. It retains the standard
`text/html;profile=mcp-app` MIME type.

This reuses the existing SVG preview and controls. It does not add new canvas UI
or change the Excalidraw editor. Images and embeds remain placeholders in the
preview; **Open canvas** opens the complete collaborative editor.

## Try it

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm check`, `pnpm test`, and `pnpm check:bundle`.
3. Deploy this branch to a test deployment with the existing GitHub OAuth setup
   described in [setup.md](setup.md). Use its HTTPS `/mcp` URL in a development
   plugin, then rescan tools. A local branch does not update an installed plugin's
   deployed endpoint.
4. In ChatGPT, create a diagram or provide an existing share link, then ask to
   view it. Verify the inline preview, refresh, theme changes, fullscreen, and
   **Open canvas**. In fullscreen, edits made in the browser should appear on the
   next four-second refresh.
5. Reopen the widget and check that it restores the same board. Switch to a
   different board and verify that the old scene disappears while the new one loads.
6. Try an invalid or revoked share link and confirm that the preview reports the
   tool error. Try a host without `window.openai` to check the MCP Apps fallback.
7. Verify `events/list` and a webhook subscription through the same endpoint;
   these still require MCP `2026-07-28` and configured callback hosts.

Unit tests cover both bridge paths and the MCP 2.0 tool/resource metadata.
Testing against a deployed development plugin in ChatGPT is still needed to
confirm host behavior, account availability, OAuth, and CSP enforcement.
