// SPDX-License-Identifier: Apache-2.0
//
// Bundles the webview render harness (test/webview/ui-render.tsx) with esbuild —
// stubbing the vite-only asset imports (SVG `?inline`, CSS modules) the way a
// headless test needs — then runs it under Node/jsdom. Reports rendered views,
// clicked buttons, and any visible-error problems. Exit non-zero on problems.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));

// CSS-module imports become a Proxy that echoes the class name (styles.foo → "foo").
const cssModuleStub = {
  name: "css-module-stub",
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, () => ({
      contents: "export default new Proxy({}, { get: (_, k) => String(k) });",
      loader: "js",
    }));
  },
};

// SVG (and `?inline` variants) become an empty string — the harness tests
// behavior/buttons, not imagery.
const assetStub = {
  name: "asset-stub",
  setup(b) {
    b.onResolve({ filter: /\.svg(\?.*)?$/ }, (a) => ({
      path: a.path,
      namespace: "asset-stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "asset-stub" }, () => ({
      contents: 'export default "";',
      loader: "js",
    }));
  },
};

const out = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "alp-webui-")),
  "h.cjs",
);
await esbuild.build({
  entryPoints: [path.join(here, "ui-render.tsx")],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: out,
  external: ["jsdom"],
  // react/react-dom live under the alp-webview workspace package (pnpm).
  nodePaths: [path.join(here, "../../packages/alp-webview/node_modules")],
  plugins: [cssModuleStub, assetStub],
  logLevel: "error",
});

const res = spawnSync(process.execPath, [out], {
  stdio: "inherit",
  env: {
    ...process.env,
    // The bundle runs from a temp dir; jsdom (external) lives in repo node_modules.
    NODE_PATH: [
      path.join(here, "../../node_modules"),
      path.join(here, "../../packages/alp-webview/node_modules"),
    ].join(path.delimiter),
  },
});
process.exit(res.status ?? 1);
