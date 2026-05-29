import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      extension: 'src/extension.ts',
      'lsp/server': 'src/lsp/server.ts',
    },
    platform: 'node',
    format: {
      cjs: {
        outputOptions: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
        },
      },
    },
    outDir: 'out',
    dts: false,
    sourcemap: true,
    deps: {
      alwaysBundle: [/.+/],
      neverBundle: ['vscode'],
    },
  },
  run: {
    cache: true,
  },
});
