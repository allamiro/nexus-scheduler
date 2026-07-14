import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  // Surfaced on the About page (§42) — a plain build-time constant
  // rather than an env var, since there's nothing to configure per
  // deployment here, just the version already in package.json.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: without it, this prefix-matches the
      // SPA's own /api-keys client-side route too (Vite's dev proxy
      // does a plain startsWith() check), sending direct navigation or
      // a refresh on that page to the backend instead of serving the
      // SPA — every real REST call is under /api/... or /auth/...
      // with something after the slash, so requiring it here
      // disambiguates the two without needing a regex.
      "/api/": "http://localhost:3000",
      "/auth/": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
