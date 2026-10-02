// Bundles the MCP App view (src/view) into one self-contained HTML file (host CSP blocks external
// scripts). It lands in public/, so Vite ships it as a static asset the worker reads via ASSETS.
import { readFileSync, writeFileSync } from "node:fs";
import { build } from "vite";

type ViewBuild = { entry: string; template: string; output: string; name: string };
const views: ViewBuild[] = [
  {
    entry: "src/view/main.ts",
    template: "src/view/index.html",
    output: "public/mcp-view.html",
    name: "DiagramView",
  },
  {
    entry: "src/view/workspace.ts",
    template: "src/view/workspace.html",
    output: "public/mcp-workspace.html",
    name: "CanvasWorkspace",
  },
];

async function buildView(view: ViewBuild) {
  const out = await build({
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: true,
      lib: { entry: view.entry, formats: ["iife"], name: view.name },
    },
  });

  const results = Array.isArray(out) ? out : [out];
  const chunk = results
    .flatMap((r) => ("output" in r ? r.output : []))
    .find((o) => o.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("view build produced no JS chunk");

  const js = chunk.code.replaceAll("</script", "<\\/script");
  const html = readFileSync(view.template, "utf8").replace("/* VIEW_SCRIPT */", () => js);
  writeFileSync(view.output, html);
  console.log(`view: ${view.output} (${(html.length / 1024).toFixed(1)} KiB)`);
}

await Promise.all(views.map(buildView));
