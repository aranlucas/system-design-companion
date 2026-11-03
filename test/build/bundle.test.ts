// Production artifact contracts, run with `pnpm check:bundle`. Count every static import:
// moving eager code into a vendor chunk must not make the home-page budget pass.
import { expect, it } from "vitest";
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

  expect(manifest[entry], `Missing manifest entry: ${entry}`).toBeDefined();
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

const workerFiles = readdirSync(workerDir, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
  .map((file) => join(workerDir, file));

const worker = sizes(workerFiles);

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

it("keeps the complete home static import graph below 300 kB", () => {
  expect(home.raw).toBeLessThan(300_000);
});

it("keeps all Worker chunks within the deployment budget", () => {
  expect(workerFiles.length, "The build must contain Worker JavaScript").toBeGreaterThan(0);
  expect(worker.raw).toBeLessThan(WORKER_BUDGET_BYTES);
});

it("ships the component library as a dynamic entry outside the canvas static graph", () => {
  expect(manifest["src/app/library.ts"]?.isDynamicEntry).toBe(true);
  expect(canvasImports.has("src/app/library.ts")).toBe(false);
});

it.each(["mcp-view.html"])("ships %s with executable inline code and no external script chunks", (asset) => {
  const html = readFileSync(`${clientDir}/${asset}`, "utf8");
  expect(html).not.toContain("/* VIEW_SCRIPT */");
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
  expect(html).toMatch(/<script[^>]*>[\s\S]+<\/script>/i);
  expect(html).toContain("ui/initialize");
  expect(html).toContain("__ORIGIN__");
});
