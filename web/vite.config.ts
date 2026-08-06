import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Lives in `web/` (20-repo-restructure US-2); the app root IS this directory, so
// `index.html` and `postcss.config.js` sit beside it. Everything outside the
// client — `contracts/`, the build output — is addressed via `..`.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

// Where `npm run dev` sends the API calls it does not serve itself — the Pinakes
// service's own default port (`services/api/src/pinakes/__main__.py`).
const API_ORIGIN = `http://localhost:${process.env.PORT ?? "3050"}`;

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@contracts": path.resolve(REPO_ROOT, "contracts"),
      "@assets": path.resolve(REPO_ROOT, "attached_assets"),
    },
  },
  root: import.meta.dirname,
  build: {
    outDir: path.resolve(REPO_ROOT, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // `npm run dev` is the CLIENT dev server now. The backend is the Python
    // service (`npm start` → `python -m pinakes`, $PORT default 3050), which
    // used to be an Express process this config knew nothing about because
    // `server/vite.ts` mounted Vite as middleware inside it. That inversion is
    // the cutover (tasks/chief/80-cutover.json US-2): one Python process serves
    // the *built* client in production, and in development Vite serves the
    // client and proxies the API across.
    proxy: {
      "/api": { target: API_ORIGIN, changeOrigin: true },
      "/.well-known": { target: API_ORIGIN, changeOrigin: true },
      "/mcp": { target: API_ORIGIN, changeOrigin: true },
    },
  },
});
