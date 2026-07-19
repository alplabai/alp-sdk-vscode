#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Re-vendor src/lsp/generated/kconfig-metadata.json: the Kconfig symbol names
// alp-sdk already publishes as SCHEMA-VALIDATED METADATA, harvested from the
// pinned alp-sdk-upstream submodule.
//
// Why this exists (and why it is not vendor-kconfig-symbols.mjs):
//   vendor-kconfig-symbols.mjs scrapes `config ALP_*` declarations out of
//   Kconfig *text* to produce the fabrication gate (test/fixtures/…txt) — bare
//   names only, and by regex, so it cannot recover type/help/defaults.
//   This script instead reads the metadata the SDK maintains under its own
//   JSON Schemas, where symbol names are a validated field rather than text we
//   pattern-match. That buys name correctness for free; it buys nothing about
//   types or help text, and this script deliberately does NOT invent either.
//
// Sources (all under the submodule's metadata/, all schema-governed):
//   metadata/chips/*.yaml                          chip-v1 requires `kconfig`
//   metadata/libraries/*.yaml                      library-v1 `kconfig`
//   metadata/registries/peripheral-kconfig.json    token -> Zephyr subsystems
//   metadata/registries/silicon-kconfig.json       silicon ref -> ALP_SOC_*
//
// TYPES ARE EMITTED ONLY WHERE PROVEN.  Chip enables are typed `bool` because
// every one of the 82 `config ALP_*` blocks in zephyr/kconfigs/chips.kconfig
// declares `bool` (verified 2026-07-19).  Everything else is emitted with NO
// type, which is load-bearing: lintPrjConf's value check reads
// `sym && sym.type === "bool" && …`, so an untyped symbol is never
// value-linted and therefore can never produce a wrong diagnostic.  Completion
// and hover still work off the name.  Do not "helpfully" default a type here.
//
// Run from the repo root after bumping the submodule:
//   node scripts/vendor-kconfig-metadata.mjs
//
// Reads pinned content from git objects (`git show HEAD:…`), not the working
// tree, so it is reproducible even when the submodule tree is dirty.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import yaml from "js-yaml";

const SUBMODULE = "alp-sdk-upstream";
const OUT = "src/lsp/generated/kconfig-metadata.json";

// A Kconfig symbol name, without the CONFIG_ prefix. The metadata files carry
// prose in these same fields for non-Zephyr backends ("n/a", "kernel at24
// EEPROM driver", "Infineon optiga-trust-m host library"), so this shape check
// is load-bearing, not defensive padding.
const SYMBOL_RE = /^[A-Z][A-Z0-9_]*$/;

function git(...args) {
  return execFileSync("git", ["-C", SUBMODULE, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function showFile(gitPath) {
  try {
    return git("show", `HEAD:${gitPath}`);
  } catch {
    return null;
  }
}

function listFiles(dir, ext) {
  try {
    return git("ls-tree", "--name-only", "HEAD", `${dir}/`)
      .split("\n")
      .filter((p) => p.endsWith(ext));
  } catch {
    return [];
  }
}

/** name -> {name, type?, doc, valueHint?, source} (first writer wins) */
const symbols = new Map();
const skipped = [];

function add(name, entry) {
  if (!SYMBOL_RE.test(name)) {
    skipped.push({ name, source: entry.source });
    return;
  }
  if (!symbols.has(name)) symbols.set(name, { name, ...entry });
}

/**
 * Collect symbol-shaped strings from every `kconfig` key anywhere in a parsed
 * YAML document. The field is a plain string in some schemas, an
 * os -> symbol map in chip-v1, and an array in library-v1 — so walk the tree
 * rather than assume one shape.
 */
function harvestKconfigKeys(node, out) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) harvestKconfigKeys(item, out);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "kconfig") {
      if (typeof value === "string") out.push(value);
      else if (Array.isArray(value)) {
        for (const v of value) if (typeof v === "string") out.push(v);
      } else if (value && typeof value === "object") {
        for (const v of Object.values(value)) {
          if (typeof v === "string") out.push(v);
        }
      }
    }
    harvestKconfigKeys(value, out);
  }
}

// ── chips ────────────────────────────────────────────────────────────────────
// chip-v1.schema.json requires `kconfig`; values are per-OS. Only the zephyr
// entry is reliably a symbol — baremetal/yocto routinely carry prose.
for (const path of listFiles("metadata/chips", ".yaml")) {
  const text = showFile(path);
  if (text === null) continue;
  const doc = yaml.load(text);
  if (!doc || typeof doc !== "object") continue;

  const kc = doc.kconfig;
  const zephyr = kc && typeof kc === "object" ? kc.zephyr : undefined;
  if (typeof zephyr !== "string") continue;

  const display = doc.display_name || doc.chip_id || "chip driver";
  const vendor = doc.vendor ? `${doc.vendor} ` : "";
  add(zephyr, {
    // Proven: all 82 `config ALP_*` blocks in chips.kconfig declare `bool`.
    type: "bool",
    doc: `Enable the ${vendor}${display} chip driver.`,
    valueHint: "y",
    source: path,
  });
}

// ── libraries ────────────────────────────────────────────────────────────────
for (const path of listFiles("metadata/libraries", ".yaml")) {
  const text = showFile(path);
  if (text === null) continue;
  const doc = yaml.load(text);
  if (!doc || typeof doc !== "object") continue;

  const found = [];
  harvestKconfigKeys(doc, found);
  const name =
    doc.name ||
    path
      .split("/")
      .pop()
      .replace(/\.yaml$/, "");
  for (const raw of found) {
    // library-v1 entries may be full assignments (`CONFIG_FOO=y`).
    const bare = raw
      .replace(/^CONFIG_/, "")
      .split("=")[0]
      .trim();
    add(bare, {
      doc: `Kconfig option declared by the \`${name}\` library manifest.`,
      source: path,
    });
  }
}

// ── peripheral registry ──────────────────────────────────────────────────────
// board.yaml `peripherals:` token -> the Zephyr subsystem symbols it implies.
// These are Zephyr's own symbols; we have no proof of their types here, so
// none is emitted.
{
  const text = showFile("metadata/registries/peripheral-kconfig.json");
  if (text !== null) {
    const reg = JSON.parse(text);
    for (const [token, syms] of Object.entries(reg.peripherals ?? {})) {
      for (const sym of syms) {
        add(sym, {
          doc: `Zephyr subsystem enabled by board.yaml \`peripherals: [${token}]\`.`,
          source: "metadata/registries/peripheral-kconfig.json",
        });
      }
    }
  }
}

// ── silicon registry ─────────────────────────────────────────────────────────
// The symbol is COMPUTED, exactly as scripts/alp_project.py:silicon_to_kconfig()
// does it: socSymbolPrefix + ref.upper().replace(":", "_").
{
  const text = showFile("metadata/registries/silicon-kconfig.json");
  if (text !== null) {
    const reg = JSON.parse(text);
    const prefix = reg.socSymbolPrefix ?? "ALP_SOC_";
    for (const ref of reg.knownSilicon ?? []) {
      add(`${prefix}${ref.toUpperCase().replaceAll(":", "_")}`, {
        type: "bool",
        doc: `Selects the \`${ref}\` SoC. Set by the SDK from board.yaml \`som.sku\` — do not set by hand.`,
        valueHint: "y",
        source: "metadata/registries/silicon-kconfig.json",
      });
    }
  }
}

// ── emit ─────────────────────────────────────────────────────────────────────
const sorted = [...symbols.values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);
const submoduleRev = git("rev-parse", "HEAD").trim();

const payload = {
  _generated:
    "AUTO-GENERATED by scripts/vendor-kconfig-metadata.mjs -- DO NOT EDIT. " +
    "Harvested from schema-validated metadata/ in the pinned alp-sdk-upstream " +
    "submodule. Types are emitted ONLY where proven; an entry without `type` " +
    "is never value-linted, by design.",
  submoduleRev,
  symbols: sorted,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

const typed = sorted.filter((s) => s.type).length;
console.log(
  `Wrote ${sorted.length} symbols (${typed} typed, ${sorted.length - typed} untyped) to ${OUT}`,
);
if (skipped.length) {
  console.log(
    `Skipped ${skipped.length} non-symbol \`kconfig\` values (prose/"n/a"), e.g. ` +
      skipped
        .slice(0, 3)
        .map((s) => JSON.stringify(s.name))
        .join(", "),
  );
}
