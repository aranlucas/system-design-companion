/// <reference types="vite/client" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Lets tests instantiate DiagramRoom (room.ts) in node with a stub base class.
      "cloudflare:workers": new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
