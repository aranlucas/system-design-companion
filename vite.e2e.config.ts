import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser journeys replace network boundaries in fixtures; keep this server local
// and omit the Cloudflare plugin so no test can reach production bindings.
export default defineConfig({ plugins: [react()] });
