import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Lives in `web/` (20-repo-restructure US-2); the app root IS this directory, so
// `index.html` and `postcss.config.js` sit beside it. Everything outside the
// client — `contracts/`, the build output — is addressed via `..`.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

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
  },
});
