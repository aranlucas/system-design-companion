import { bindings, defineConfig, exports } from "cf/config";

// The OAuth provider owns /mcp, its discovery documents, and its token and
// registration endpoints, so those paths must reach the Worker rather than the
// SPA fallback. This file and wrangler.jsonc have to stay in sync.
const RUN_WORKER_FIRST = [
  "/api/*",
  "/ws/*",
  "/mcp",
  "/authorize",
  "/github/*",
  "/oauth/*",
  "/.well-known/oauth-*",
];

const COMPATIBILITY_FLAGS = ["nodejs_compat", "global_fetch_strictly_public"];

export default defineConfig((ctx) => {
  if (ctx.isPreview) {
    return {
      worker: {
        exports: {
          DiagramRoom: exports.durableObject({ storage: "sqlite" }),
        },
        name: "system-design-companion",
        compatibilityDate: "2026-09-01",
        compatibilityFlags: COMPATIBILITY_FLAGS,
        entrypoint: "src/worker/index.ts",
        observability: {
          enabled: true,
        },
        assets: {
          notFoundHandling: "single-page-application",
          runWorkerFirst: RUN_WORKER_FIRST,
        },
        env: {
          DB: bindings.d1({
            name: "system-design-companion-preview",
            id: "511519d3-cbd6-44be-8f66-a67e835bc5eb",
          }),
          BUCKET: bindings.r2({
            name: "system-design-companion-preview",
          }),
          // bindings.kv takes only the id; wrangler.jsonc is where the name lives.
          OAUTH_KV: bindings.kv({ id: "b7d3e90c14f24a8ea5b6c1d82f0a3947" }),
          ROOM: bindings.durableObject({
            worker: "system-design-companion",
            exportName: "DiagramRoom",
          }),
          ASSETS: bindings.assets(),
        },
      },
    };
  }
  return {
    worker: {
      exports: {
        DiagramRoom: exports.durableObject({ storage: "sqlite" }),
      },
      name: "system-design-companion",
      compatibilityDate: "2026-09-01",
      compatibilityFlags: COMPATIBILITY_FLAGS,
      entrypoint: "src/worker/index.ts",
      observability: {
        enabled: true,
      },
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: RUN_WORKER_FIRST,
      },
      env: {
        DB: bindings.d1({
          name: "system-design-companion",
          id: "821bb52f-1ad9-4534-9db0-09232af6e753",
        }),
        BUCKET: bindings.r2({
          name: "system-design-companion",
        }),
        // bindings.kv takes only the id; wrangler.jsonc is where the name lives.
        OAUTH_KV: bindings.kv({ id: "e4b1c2a95f0d4f7ea38c6b1902d7e5f43" }),
        ROOM: bindings.durableObject({
          worker: "system-design-companion",
          exportName: "DiagramRoom",
        }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
