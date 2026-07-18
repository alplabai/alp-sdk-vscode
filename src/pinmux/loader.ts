// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { PinmuxTable, isResolvedE1mPad } from "@alp-sdk/core/pinmux/models";
import { parsePinmuxTable } from "@alp-sdk/core/pinmux/parse";

export type ReadFileFn = (filePath: string) => string;

/**
 * SKU prefix -> metadata/pinmux/<family>.yaml file stem.  Only families with a
 * generated capability table resolve to data; the rest fail soft in
 * loadPinmuxTable (today only aen.yaml is generated upstream).
 */
const SKU_PINMUX_FAMILY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^E1M-AEN/, "aen"],
  [/^E1M-NX9/, "imx93"],
  [/^E1M-V2N/, "v2n"],
  [/^E1M-V2M/, "v2n-m1"],
];

export function pinmuxFamilyForSku(sku: string): string | null {
  for (const [pattern, family] of SKU_PINMUX_FAMILY) {
    if (pattern.test(sku)) {
      return family;
    }
  }

  return null;
}

const tableCache = new Map<string, PinmuxTable | null>();

/** Load (and cache) the pinmux capability table for a SoM SKU.  Null when unknown or unreadable. */
export function loadPinmuxTable(
  sdkRoot: string,
  sku: string,
  readFile: ReadFileFn = (filePath) => fs.readFileSync(filePath, "utf8"),
): PinmuxTable | null {
  const family = pinmuxFamilyForSku(sku);
  if (!family) {
    return null;
  }

  const cacheKey = `${sdkRoot}::${family}`;
  const cached = tableCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let table: PinmuxTable | null = null;
  try {
    const filePath = path.join(sdkRoot, "metadata", "pinmux", `${family}.yaml`);
    const parsed = parsePinmuxTable(readFile(filePath));
    // A readable-but-corrupt or empty table parses to a truthy object with
    // no pads. An uncharacterized-stub table parses with pads whose e1m_pad
    // is all "TBD" (the upstream v2n.yaml ships 207 such pads today). In
    // either case the physical-pad mapping is unknown, so pad-ownership (R2)
    // can't be checked and the function list isn't authoritative — treat the
    // table as absent so callers don't flood false diagnostics against it.
    // (Pads keep their "TBD" markers once at least one is resolved, so R2
    // still skips the unresolved ones; see checkE1mCompliance.)
    const resolvedPads = parsed
      ? parsed.pads.filter((pad) => isResolvedE1mPad(pad.e1mPad)).length
      : 0;
    table = parsed && resolvedPads === 0 ? null : parsed;
  } catch {
    table = null;
  }

  tableCache.set(cacheKey, table);
  return table;
}

export function clearPinmuxTableCache(): void {
  tableCache.clear();
}
