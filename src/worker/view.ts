// The get_scene MCP App view. scripts/build-view.ts builds it into a static asset
// (public/mcp-view.html); the resource handler reads it back through the ASSETS binding.

export const VIEW_URI = "ui://system-design-canvas/diagram.html";

const ERROR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" /></head>
<body style="font:13px system-ui;color:#868e96;padding:16px">Diagram view unavailable.</body></html>`;

export async function viewHtml(env: Env, origin: string): Promise<string> {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/mcp-view.html`));
    const html = await res.text();
    // The SPA fallback answers 200 with index.html when the view wasn't built.
    if (!res.ok || !html.includes('name="mcp-view"')) throw new Error(`status ${res.status}`);
    // The font is served from this worker, which the resource's CSP allows via resourceDomains.
    return html.replaceAll("__ORIGIN__", origin);
  } catch (e) {
    console.error("mcp view:", e);
    return ERROR_HTML;
  }
}
