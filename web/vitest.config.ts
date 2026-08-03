import { defineConfig } from "vitest/config";
import path from "path";

// The config file lives in `web/` (20-repo-restructure US-2) but the suite still
// spans the whole repo — `web/`, `server/`, `scripts/`, `contracts/`, `test/` —
// so the vitest root stays the repo root. Invoke it via `npm test`, which passes
// `--config web/vitest.config.ts`; a bare `vitest` would find no config and run
// with defaults (no `@`/`@contracts` aliases).
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: REPO_ROOT,
  test: {
    globals: true,
    include: ["**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(REPO_ROOT, "web", "src"),
      "@contracts": path.resolve(REPO_ROOT, "contracts"),
    },
  },
});
