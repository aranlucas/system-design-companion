import { defineConfig } from "vitest/config";

// Artifact checks require a production build; unit tests remain build-independent.
export default defineConfig({
  test: {
    include: ["test/build/**/*.test.ts"],
    environment: "node",
  },
});
