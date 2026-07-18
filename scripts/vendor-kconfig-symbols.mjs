#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Re-vendor test/fixtures/alp-kconfig-symbols.txt: the sorted set of every
// `config ALP_*` symbol reachable from alp-sdk-upstream's zephyr/Kconfig (at
// the pinned submodule commit). alp-sdk#458 split the former monolith into
// zephyr/Kconfig (just ALP_SDK) + ~16 rsourced fragments under
// zephyr/kconfigs/ (plus a couple of further nested rsource/source includes,
// e.g. Kconfig.alp-libraries -> ../src/lib/gfx_compat/Kconfig), so this walks
// `rsource`/`source` includes recursively from the root instead of reading a
// fixed file list. The prj.conf LSP curated list (src/lsp/kconfig.ts) is
// gated against this snapshot in test/lsp.kconfig.test.js — vendored, like
// the JSON schemas, so CI never depends on the submodule working tree.
//
// Run from the repo root after bumping the submodule:  node scripts/vendor-kconfig-symbols.mjs
//
// Reads the pinned content from git objects (`git show HEAD:…`), not the working
// tree, so it is reproducible even when the working tree is dirty.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { posix } from "node:path";

const SUBMODULE = "alp-sdk-upstream";
const ROOT_KCONFIG = "zephyr/Kconfig";
const OUT = "test/fixtures/alp-kconfig-symbols.txt";

const CONFIG_RE = /(?:^|[\r\n])[ \t]*config[ \t]+(ALP_[A-Z0-9_]+)/g;
// Zephyr semantics: `rsource "p"` resolves relative to the dir of the
// *including* file; `source "p"` resolves relative to the Kconfig base
// (here: the submodule root, our stand-in for $srctree).
const INCLUDE_RE = /^[ \t]*(r?source)[ \t]+"([^"]+)"/gm;

function showFile(gitPath) {
  try {
    return execFileSync("git", ["-C", SUBMODULE, "show", `HEAD:${gitPath}`], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const symbols = new Set();
const visited = new Set(); // include-cycle / diamond-include guard

function walk(gitPath) {
  const path = posix.normalize(gitPath);
  if (visited.has(path)) return;
  visited.add(path);

  const text = showFile(path);
  if (text === null) {
    console.warn(
      `vendor-kconfig-symbols: skipping missing/unreachable Kconfig fragment "${path}"`,
    );
    return;
  }

  for (const m of text.matchAll(CONFIG_RE)) symbols.add(m[1]);

  const dir = posix.dirname(path);
  for (const [, kind, rel] of text.matchAll(INCLUDE_RE)) {
    walk(kind === "rsource" ? posix.join(dir, rel) : rel);
  }
}

walk(ROOT_KCONFIG);

const sorted = [...symbols].sort();

const header = [
  "# Vendored ALP_* Kconfig symbols — every `config ALP_*` reachable via",
  "# rsource/source from alp-sdk-upstream's zephyr/Kconfig (alp-sdk#458 split",
  "# the monolith into zephyr/kconfigs/*.kconfig fragments) at the pinned",
  "# submodule commit. The prj.conf LSP curated list (src/lsp/kconfig.ts) is",
  "# gated against this in test/lsp.kconfig.test.js. Vendored — like",
  "# schemas/*.json — so CI never depends on the submodule working tree.",
  "# Re-vendor: node scripts/vendor-kconfig-symbols.mjs",
  "",
];

writeFileSync(OUT, header.concat(sorted, "").join("\n"));
console.log(`Wrote ${sorted.length} symbols to ${OUT}`);
