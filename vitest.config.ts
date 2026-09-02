import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors the alias in vite.config.ts (see the comment there).
    alias: {
      "image-size": fileURLToPath(
        new URL("./shims/image-size/index.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    server: {
      deps: {
        // Vitest lets Node load node_modules packages natively, which would
        // bypass the alias above. Inline remark-docx so its own
        // `import "image-size"` goes through Vite and reaches the shim.
        inline: [/remark-docx/],
      },
    },
  },
});
