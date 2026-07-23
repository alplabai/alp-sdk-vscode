// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { PinmuxTable } from "@alp-sdk/core/pinmux/models";
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
  // V2M is the same PCB/E1M edge as V2N (the M1 delta is SoM-internal DEEPX
  // nets, not an edge pinout), so it shares the v2n capability table.
  [/^E1M-V2M/, "v2n"],
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

  const filePath = path.join(sdkRoot, "metadata", "pinmux", `${family}.yaml`);

  // Key the cache on the table file's mtime so an in-place edit of
  // metadata/pinmux/<family>.yaml (routine when working on alp-sdk itself) is
  // picked up on the next validation instead of surviving until an LSP
  // restart. mtime is best-effort: an absent file or an injected readFile
  // leaves it 0, which is harmless.
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const cacheKey = `${sdkRoot}::${family}::${mtimeMs}`;
  const cached = tableCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let table: PinmuxTable | null = null;
  try {
    const parsed = parsePinmuxTable(readFile(filePath));
    // Drop rows the SDK generator left as "TBD" sentinels (every pad-first V2N
    // row today carries no real E1M pad->function mapping). A table left with
    // no usable pads — or a readable-but-corrupt/empty one — is treated as
    // absent so callers fail soft (no check, like imx93) instead of flooding
    // false "not available"/duplicate-pad diagnostics against sentinel rows.
    if (parsed) {
      parsed.pads = parsed.pads.filter((pad) => pad.e1mPad !== "TBD");
    }
    table = parsed && parsed.pads.length === 0 ? null : parsed;
  } catch {
    table = null;
  }

  // Only cache a real table. A null (SDK not populated yet, or a transient
  // read error) must not stick — the next call re-reads, so a populated SDK is
  // picked up without an LSP restart.
  if (table !== null) {
    tableCache.set(cacheKey, table);
  }
  return table;
}

export function clearPinmuxTableCache(): void {
  tableCache.clear();
}
