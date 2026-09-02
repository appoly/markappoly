import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// remark-docx imports `image-size` to measure images before embedding them in
// a .docx. Every published image-size release carries unfixed denial-of-service
// advisories, so package.json `overrides` swaps the registry package for an
// empty stub and this alias points the import at our own bounded parser.
// Keep in sync with the same alias in vitest.config.ts and `paths` in tsconfig.json.
const imageSizeShim = fileURLToPath(
  new URL("./shims/image-size/index.js", import.meta.url),
);

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: { "image-size": imageSizeShim },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
