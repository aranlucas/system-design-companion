// Run after `pnpm build`. Count the full static import graph, not just the entry chunk:
// moving eager code into a vendor chunk must not make the home-page budget pass.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod/mini";

const clientDir = ".cloudflare/output/v0/workers/default/assets";

const manifest = z
  .record(
    z.string(),
    z.object({
      file: z.string(),
      imports: z.optional(z.array(z.string())),
      isDynamicEntry: z.optional(z.boolean()),
    }),
  )
  .parse(JSON.parse(readFileSync(`${clientDir}/.vite/manifest.json`, "utf8")));

function staticFiles(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) {
    return seen;
  }

  assert.ok(manifest[entry], `Missing manifest entry: ${entry}`);
  seen.add(entry);

  for (const dependency of manifest[entry].imports ?? []) {
    staticFiles(dependency, seen);
  }

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
const workerDir = ".cloudflare/output/v0/workers/default/bundle";

const worker = sizes(
  readdirSync(workerDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
    .map((file) => join(workerDir, file)),
);

const view = sizes([`${clientDir}/mcp-view.html`]);

const canvasImports = staticFiles("src/app/canvas.tsx");

const canvas = sizes([...canvasImports].map((entry) => join(clientDir, manifest[entry].file)));

// eslint-disable-next-line no-console -- This CLI command reports its validation/build results to the terminal.
console.table({
  "Home JavaScript (static imports)": home,
  "Canvas JavaScript (static imports)": canvas,
  "Worker JavaScript (all chunks)": worker,
  "MCP view HTML (self-contained)": view,
});

// The Worker budget covers every chunk, including the lazily loaded OAuth
// provider (~250 kB of @cloudflare/workers-oauth-provider). It is loaded only
// for /mcp and the OAuth endpoints, but the total is what ships.
// The shared Auth integration adds ~34 kB for openid-client and signed OIDC verification.
const WORKER_BUDGET_BYTES = 750_000;

assert.ok(home.raw < 300_000, `Home JavaScript exceeds 300 kB: ${home.raw} bytes`);

assert.ok(
  worker.raw < WORKER_BUDGET_BYTES,
  `Worker JavaScript exceeds ${WORKER_BUDGET_BYTES / 1000} kB: ${worker.raw} bytes`,
);

assert.ok(manifest["src/app/library.ts"]?.isDynamicEntry, "Component library must be a lazy chunk");

assert.ok(!canvasImports.has("src/app/library.ts"), "Canvas must not eagerly import the library");
