import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Root-level config so `vp build` / `vite build` works from the repo root.
// The actual webview source + index.html live in packages/alp-webview/.
export default {
  root: fileURLToPath(new URL("./packages/alp-webview", import.meta.url)),
  plugins: [react()],
  build: {
    // outDir is relative to root above → packages/alp-webview/dist
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // IIFE required: webview <script> tag has no type="module"
        format: "iife",
        name: "AlpIdeHub",
        entryFileNames: "main.js",
        chunkFileNames: "[name].js",
        assetFileNames: (info: { name?: string }) => {
          if (info.name?.endsWith(".css")) return "main.css";
          return info.name ?? "[name][extname]";
        },
      },
    },
  },
};
