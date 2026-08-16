import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Extract every stylesheet into ONE dist/main.css instead of letting Vite
    // inline it into the JS bundle. `buildWebviewHtml` links that exact file by
    // name (it cannot read a manifest), so with the default (`true`) the link
    // 404s on every webview open — "Webview.loadLocalResource - Error using
    // fileReader" — and the page depends on the bundle injecting a <style> at
    // runtime, which needs `style-src 'unsafe-inline'` and flashes unstyled
    // first. Extracting also keeps assetFileNames' .css branch below reachable.
    cssCodeSplit: false,
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
