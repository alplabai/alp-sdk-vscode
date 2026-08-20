// SPDX-License-Identifier: Apache-2.0
//
// Which runtimes a core can be given, and the silicon-class guess behind it.
//
// Shared by the Board Configurator's per-core runtime picker and the New Project
// wizard's Cores step (#534): two surfaces that must offer the same answer for
// the same core id, or a project scaffolded one way could not be edited the
// other.

export type CoreClass = "cortex-m" | "cortex-a" | "unknown";

/** Best-effort silicon class from the core ID (stopgap until the CLI emits the
 *  SoM topology's per-core class): m33/m55/… → Cortex-M, a55/a32/… → Cortex-A.
 *
 *  This used to carry a "KEEP IN SYNC with Rust `infer_runtime_for_core_id`
 *  (`cli-rs/crates/alp-core/src/wizard/service.rs`)" note. That counterpart is
 *  gone: `cli-rs/` is down to six files with no `wizard/`, and the symbol
 *  returns no hit anywhere on an alplabai default branch — the Rust wizard did
 *  not survive the cli-rs → tan-cli move. So this heuristic is UNPAIRED, and
 *  nothing here or in CI can gate it. If tan grows a per-core class in its
 *  topology output, delete this function rather than re-pairing it.
 *
 *  The old note also recorded a deliberate divergence worth keeping if a
 *  counterpart ever reappears: a runtime picker must resolve an unknown id to
 *  something (it chose `zephyr`), whereas this returns "unknown" on purpose so
 *  the UI offers every OS option instead of pre-committing the user. */
export function coreSiliconClass(id: string): CoreClass {
  const s = id.toLowerCase();
  if (/(^|[_-])m\d/.test(s)) return "cortex-m";
  if (/(^|[_-])a\d/.test(s)) return "cortex-a";
  return "unknown";
}

/** Runtimes selectable for a core, gated by silicon class: a Cortex-A core runs
 *  Linux (Yocto) or off — you never pick Zephyr there; a Cortex-M core runs
 *  Zephyr (default), bare-metal, or off. Unknown ids fall back to all four. */
export function runtimeOptions(id: string): Array<[string, string]> {
  const cls = coreSiliconClass(id);
  if (cls === "cortex-m")
    return [
      ["zephyr", "Zephyr (default)"],
      ["baremetal", "Bare-metal"],
      ["off", "Off (skip core)"],
    ];
  if (cls === "cortex-a")
    return [
      ["yocto", "Yocto Linux (default)"],
      ["off", "Off (skip core)"],
    ];
  return [
    ["zephyr", "Zephyr"],
    ["yocto", "Yocto Linux"],
    ["baremetal", "Bare-metal"],
    ["off", "Off (skip core)"],
  ];
}
