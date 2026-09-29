import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig((ctx) => {
  if (ctx.isPreview) {
    return {
      worker: {
        exports: {
          DiagramRoom: exports.durableObject({ storage: "sqlite" }),
        },
        name: "system-design-companion",
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat"],
        entrypoint: "src/worker/index.ts",
        observability: {
          enabled: true,
        },
        assets: {
          notFoundHandling: "single-page-application",
          runWorkerFirst: ["/api/*", "/ws/*", "/mcp"],
        },
        env: {
          DB: bindings.d1({
            name: "system-design-companion-preview",
            id: "511519d3-cbd6-44be-8f66-a67e835bc5eb",
          }),
          BUCKET: bindings.r2({
            name: "system-design-companion-preview",
          }),
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
      compatibilityFlags: ["nodejs_compat"],
      entrypoint: "src/worker/index.ts",
      observability: {
        enabled: true,
      },
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api/*", "/ws/*", "/mcp"],
      },
      env: {
        DB: bindings.d1({
          name: "system-design-companion",
          id: "821bb52f-1ad9-4534-9db0-09232af6e753",
        }),
        BUCKET: bindings.r2({
          name: "system-design-companion",
        }),
        ROOM: bindings.durableObject({
          worker: "system-design-companion",
          exportName: "DiagramRoom",
        }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
