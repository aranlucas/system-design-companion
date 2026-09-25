import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Vite leaves server builds unminified by default; the Worker is deployed code too.
  build: { manifest: true, minify: true },
});
