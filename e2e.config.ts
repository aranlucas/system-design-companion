import type { E2EConfig } from "e2e";
import { engine } from "./e2e/web-engine.ts";

export default {
  tests: "e2e/**/*.e2e.ts",
  targets: [
    {
      name: "chromium",
      engine,
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "pnpm",
          args: [
            "exec",
            "vite",
            "--config",
            "vite.e2e.config.ts",
            "--host",
            "127.0.0.1",
            "--port",
            "{port}",
            "--strictPort",
          ],
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
  reporters: ["list", "junit"],
  workers: 1,
  retries: 0,
} satisfies E2EConfig;
