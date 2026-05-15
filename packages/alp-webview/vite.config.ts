import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, "index.html"),
            output: {
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
