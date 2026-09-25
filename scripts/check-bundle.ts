// Run after `pnpm build`. Count the full static import graph, not just the entry chunk:
// moving eager code into a vendor chunk must not make the home-page budget pass.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Manifest } from "vite";

const clientDir = "dist/client";
const manifest: Manifest = JSON.parse(readFileSync(`${clientDir}/.vite/manifest.json`, "utf8"));

function staticFiles(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  assert(manifest[entry], `Missing manifest entry: ${entry}`);
  seen.add(entry);
  for (const dependency of manifest[entry].imports ?? []) staticFiles(dependency, seen);
  return seen;
}

function sizes(files: string[]) {
  return files.reduce(
    (total, file) => {
      const bytes = readFileSync(file);
      return { raw: total.raw + bytes.length, gzip: total.gzip + gzipSync(bytes).length };
    },
    { raw: 0, gzip: 0 },
  );
}

const home = sizes(
  [...staticFiles("index.html")].map((entry) => join(clientDir, manifest[entry].file)),
);
// Include every Worker chunk so splitting the Worker cannot hide its total size.
const workerDir = "dist/system_design_companion";
const worker = sizes(
  readdirSync(workerDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
    .map((file) => join(workerDir, file)),
);
const view = sizes([`${clientDir}/mcp-view.html`]);
const canvasImports = staticFiles("src/app/canvas.tsx");
const canvas = sizes([...canvasImports].map((entry) => join(clientDir, manifest[entry].file)));
console.table({
  "Home JavaScript (static imports)": home,
  "Canvas JavaScript (static imports)": canvas,
  "Worker JavaScript (all chunks)": worker,
  "MCP view HTML (self-contained)": view,
});

assert(home.raw < 300_000, `Home JavaScript exceeds 300 kB: ${home.raw} bytes`);
assert(worker.raw < 550_000, `Worker JavaScript exceeds 550 kB: ${worker.raw} bytes`);
assert(manifest["src/app/library.ts"]?.isDynamicEntry, "Component library must be a lazy chunk");
assert(!canvasImports.has("src/app/library.ts"), "Canvas must not eagerly import the library");
