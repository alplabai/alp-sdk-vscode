import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
      output: {
        // IIFE format: the webview script tag has no type="module",
        // so an ESM bundle would silently fail to execute.
        format: "iife",
        name: "AlpIdeHub",
        // Deterministic filenames for localResourceRoots mapping
        entryFileNames: "main.js",
        chunkFileNames: "[name].js",
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "main.css";
          return info.name ?? "[name][extname]";
        },
      },
    },
  },
});
