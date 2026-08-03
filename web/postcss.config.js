import path from "path";

export default {
  plugins: {
    // Tailwind's postcss plugin resolves its config relative to `process.cwd()`
    // (the repo root — every entry point runs from there), not relative to this
    // file, so point at `web/tailwind.config.ts` explicitly.
    tailwindcss: {
      config: path.resolve(import.meta.dirname, "tailwind.config.ts"),
    },
    autoprefixer: {},
  },
}
