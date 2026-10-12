// SPDX-License-Identifier: Apache-2.0
//
// The per-core "Toolchain" field (#314).
//
// It writes ONE thing: `cores.<id>.toolchain` in board.yaml (alp-sdk#964,
// schema v0.17.0-rc2), a free-form id that overrides the SoM preset's
// `topology.<id>.toolchain`. It never touches the environment — the build
// plan owns `ZEPHYR_TOOLCHAIN_VARIANT`, and a second writer would silently
// win over it (`test/alpCli.planOwnedEnv.test.js`).
//
// Blank REMOVES the key rather than writing `toolchain: ""`: the schema reads
// an absent key as "keep the derived default", and an empty string would be
// passed through verbatim as a toolchain id nobody has.

import type { CoreEntry } from "../../types";

/** Apply the field's text to a core draft: trimmed value, or no key at all. */
export function applyToolchainOverride(core: CoreEntry, text: string): void {
  const id = text.trim();
  if (id) core.toolchain = id;
  else delete core.toolchain;
}

/** Placeholder naming what an empty field means for this core. */
export function toolchainPlaceholder(defaultToolchain?: string): string {
  return defaultToolchain ? `${defaultToolchain} (SoM default)` : "SoM default";
}

/** The hint under the field: where the effective value shows up. */
export const TOOLCHAIN_HINT =
  "Optional. Leave empty to keep the SoM default. The toolchain a build " +
  "actually used appears in the Build Plan's toolchain row after the next build.";
