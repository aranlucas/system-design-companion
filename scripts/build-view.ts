// Bundles the MCP App view (src/view) into one self-contained HTML file (host CSP blocks external
// scripts). It lands in public/, so Vite ships it as a static asset the worker reads via ASSETS.
import { readFileSync, writeFileSync } from "node:fs";
import { build } from "vite";

const out = await build({
  configFile: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    minify: true,
    lib: { entry: "src/view/main.ts", formats: ["iife"], name: "DiagramView" },
  },
});

const results = Array.isArray(out) ? out : [out];

const chunk = results
  .flatMap((r) => ("output" in r ? r.output : []))
  .find((o) => o.type === "chunk");

if (chunk?.type !== "chunk") {
  throw new Error("view build produced no JS chunk");
}

const js = chunk.code.replaceAll("</script", String.raw`<\/script`);

const html = readFileSync("src/view/index.html", "utf8").replace("/* VIEW_SCRIPT */", () => js);

writeFileSync("public/mcp-view.html", html);

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.log(`view: public/mcp-view.html (${(html.length / 1024).toFixed(1)} KiB)`);
