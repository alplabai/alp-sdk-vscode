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

/**
 * The Cores row of the New Project wizard's Confirm step.
 *
 * THE CUSTOMER'S ANSWERS, never the SoM's declared topology. The row used to
 * render `modules[].cores` -- what `tan presets` says the part HAS -- so a core
 * set to "Off (skip core)" was listed as enabled on the one screen whose whole
 * job is to be checked before Create (#582).
 *
 * Named with the SAME labels the Cores step offered, so the confirmation reads
 * back what was picked rather than the wire value.
 *
 * NO APP DIRECTORY APPEARS HERE, deliberately. tan chooses the app core's
 * directory itself and its choice wins (`applyCoreAssignments`); measured on
 * the pinned tan 0.6.0-rc1, `minimal-app` scaffolds `app: .` while this
 * wizard's default for that core is `./src`. A directory printed here would be
 * wrong on essentially every project -- a promise broken at Create, which is
 * the failure this row exists to prevent. The directories are editable on the
 * Cores step, and the one tan overrode is reported by name afterwards.
 *
 * A function rather than JSX so it can be tested as data: rendering the wizard
 * far enough to reach Confirm is exactly the thing no gate in this repo did,
 * which is how the row went unwatched.
 */
export function coresSummary(
  choices: ReadonlyArray<{ id: string; os: string }>,
): string {
  return choices
    .map((choice) => {
      const label = runtimeOptions(choice.id).find(
        ([value]) => value === choice.os,
      )?.[1];
      return `${choice.id} (${label ?? choice.os})`;
    })
    .join(", ");
}
