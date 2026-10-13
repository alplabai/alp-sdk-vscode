// SPDX-License-Identifier: Apache-2.0
//
// The per-core "Toolchain" field (#314).
//
// It writes ONE thing: `cores.<id>.toolchain` in board.yaml (alp-sdk#964,
// schema first in v0.17.0-rc1), a free-form id that overrides the SoM preset's
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
export function toolchainPlaceholder(
  defaultToolchain?: string,
  inTopology = true,
): string {
  if (!inTopology) return "not a core of this SoM; no default";
  return defaultToolchain ? `${defaultToolchain} (SoM default)` : "SoM default";
}

/** Shown instead of the hint when the project's SDK predates the key. */
export const TOOLCHAIN_UNSUPPORTED_HINT =
  "Needs alp-sdk >= 0.17.0: this SDK's board schema does not accept cores.<id>.toolchain.";

/** Shown when the file already carries the key and the schema rejects it. */
export const TOOLCHAIN_REJECTED_WARNING =
  "board.yaml sets cores.<id>.toolchain, which this SDK's board schema rejects (needs alp-sdk >= 0.17.0). Clear the field or update the SDK.";

/** Shown when the key is present but empty or not a string. */
export const TOOLCHAIN_INVALID_WARNING =
  "board.yaml has an empty or non-string toolchain for this core, which is not the SoM default. Type a toolchain id, or clear the field to remove the key.";

/** The hint under the field: where the effective value shows up. No timing
 *  is promised — the Build Plan can show a live projection as well as the
 *  manifest of a finished build. */
export const TOOLCHAIN_HINT =
  "Optional. Leave empty to keep the SoM default. The toolchain the build " +
  "plan resolves is shown on this core's line in the Build Plan.";

/** `<datalist>` id for one suggestion list: cores offering the same list share
 *  one datalist. The id is a djb2 hash of the exact list in base 36, so equal
 *  lists collide on purpose and different lists get different ids. */
export function toolchainListId(suggestions: readonly string[]): string {
  const key = suggestions.join("\n");
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `alp-configurator-toolchains-${h.toString(36)}`;
}
