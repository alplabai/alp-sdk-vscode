#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Re-vendor schemas/alp-kconfig-symbols.txt: the sorted set of every
// `config ALP_*` symbol in alp-sdk-upstream's zephyr Kconfig (at the pinned
// submodule commit). The prj.conf LSP curated list (src/lsp/kconfig.ts) is gated
// against this snapshot in test/lsp.kconfig.test.js — vendored, like the JSON
// schemas, so CI never depends on the submodule working tree.
//
// Run from the repo root after bumping the submodule:  node scripts/vendor-kconfig-symbols.mjs
//
// Reads the pinned content from git objects (`git show HEAD:…`), not the working
// tree, so it is reproducible even when the working tree is dirty.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SUBMODULE = "alp-sdk-upstream";
const KCONFIGS = ["zephyr/Kconfig", "zephyr/Kconfig.alp-libraries"];
const OUT = "test/fixtures/alp-kconfig-symbols.txt";

const text = KCONFIGS.map((p) =>
  execFileSync("git", ["-C", SUBMODULE, "show", `HEAD:${p}`], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  }),
).join("\n");

const symbols = [
  ...new Set(
    [...text.matchAll(/(?:^|[\r\n])[ \t]*config[ \t]+(ALP_[A-Z0-9_]+)/g)].map(
      (m) => m[1],
    ),
  ),
].sort();

const header = [
  "# Vendored ALP_* Kconfig symbols — every `config ALP_*` in alp-sdk-upstream's",
  "# zephyr/Kconfig + zephyr/Kconfig.alp-libraries at the pinned submodule commit.",
  "# The prj.conf LSP curated list (src/lsp/kconfig.ts) is gated against this in",
  "# test/lsp.kconfig.test.js. Vendored — like schemas/*.json — so CI never depends",
  "# on the submodule working tree. Re-vendor: node scripts/vendor-kconfig-symbols.mjs",
  "",
];

writeFileSync(OUT, header.concat(symbols, "").join("\n"));
console.log(`Wrote ${symbols.length} symbols to ${OUT}`);
