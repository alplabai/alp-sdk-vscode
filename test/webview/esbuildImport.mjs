// SPDX-License-Identifier: Apache-2.0
//
// Imports one webview TypeScript module into a node:test file. The webview's
// modules are TS and are only otherwise exercised through the jsdom render
// harness, so pure arithmetic had no unit tests at all (#664 recorded that
// gap for regionWindow.ts). esbuild is already a dev dependency here.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function importWebviewModule(relPath) {
  const dir = await mkdtemp(join(tmpdir(), "alp-webview-unit-"));
  const outfile = join(dir, "module.mjs");
  await build({
    entryPoints: [join(process.cwd(), "packages/alp-webview/src", relPath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  await rm(dir, { recursive: true, force: true });
  return mod;
}
