// SPDX-License-Identifier: Apache-2.0

import {
  AcceleratorAvail,
  BoardPreset,
  ChipDef,
  SdkCatalogue,
  SomPreset,
} from "./models";

function somBySku(catalogue: SdkCatalogue, sku: string): SomPreset | undefined {
  return catalogue.soms.find((s) => s.sku === sku);
}

/**
 * `data.boardLibraries` out of a `tan presets` envelope, or `[]` when the
 * payload does not carry one.
 *
 * Everything here is `unknown` on purpose: the envelope crosses a process
 * boundary from a separately-versioned binary, so its shape is a claim, not a
 * guarantee. The element type stays `unknown` and `withPresetLibraries` does
 * the per-entry narrowing.
 */
export function boardLibrariesFromPresets(data: unknown): readonly unknown[] {
  if (!data || typeof data !== "object") return [];
  const value = (data as Record<string, unknown>).boardLibraries;
  return Array.isArray(value) ? value : [];
}

/**
 * The catalogue with `tan presets`' library vocabulary in place of the scanned
 * one — when the CLI actually answered with a vocabulary.
 *
 * board.yaml's `libraries[]` takes canonical manifest names (#564), and `tan
 * presets` reports exactly that set as `data.boardLibraries`. The filesystem
 * scan reads the same names off `metadata/libraries/`, so this is a change of
 * source, not of meaning.
 *
 * An EMPTY list is not an answer, and must not be treated as one. With an
 * unresolved SDK `tan presets` does not fail: it exits 0 with `ok: true`, omits
 * the `sdk` envelope key entirely, returns an empty `boardLibraries`, and says
 * so only through `issues[].code == presets.sdk-root-unresolved`. Overwriting
 * on that would blank a picker the scan could still have filled, so an empty
 * list leaves the fallback standing.
 *
 * Unknown entries are DROPPED rather than coerced: a forward-compatible tan
 * that grows a richer element type must not be stringified into a name no
 * schema accepts.
 */
export function withPresetLibraries(
  catalogue: SdkCatalogue,
  presetLibraryIds: readonly unknown[],
): SdkCatalogue {
  const ids = presetLibraryIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort((a, b) => a.localeCompare(b));

  if (ids.length === 0) return catalogue;

  return { ...catalogue, libraries: ids.map((id) => ({ id })) };
}

export function boardsForSom(
  catalogue: SdkCatalogue,
  sku: string,
): BoardPreset[] {
  const som = somBySku(catalogue, sku);
  if (!som) return [];
  return catalogue.boards.filter((b) =>
    b.hostsSomFamilies.includes(som.family),
  );
}

export function coreIdsForSom(catalogue: SdkCatalogue, sku: string): string[] {
  return somBySku(catalogue, sku)?.topologyCoreIds ?? [];
}

export function chipDefaults(board: BoardPreset): Record<string, boolean> {
  return board.populated;
}

export function acceleratorAvailability(som: SomPreset): AcceleratorAvail[] {
  const pb = som.preferredBackend;
  const hasDeepx = som.capabilities.deepx_dx === true;
  return [
    { id: "ethos_u", label: "Ethos-U", available: pb === "ethos_u" },
    { id: "drpai", label: "DRP-AI", available: pb === "drpai" },
    {
      id: "deepx_dxm1",
      label: "DeepX DX-M1",
      available: hasDeepx || pb === "deepx_dxm1",
    },
    { id: "cpu", label: "CPU fallback", available: true },
  ];
}

const SKU_FAMILY_PREFIXES: { re: RegExp; family: string }[] = [
  { re: /^E1M-AEN/, family: "aen" },
  { re: /^E1M-NX9/, family: "imx93" },
  { re: /^E1M-V2M/, family: "v2n-m1" },
  { re: /^E1M-V2N/, family: "v2n" },
];

/** The chip `families` token for a SoM SKU (matches metadata/e1m_modules/<token>/). */
export function chipFamilyForSku(sku: string): string | undefined {
  for (const { re, family } of SKU_FAMILY_PREFIXES) {
    if (re.test(sku)) return family;
  }
  return undefined;
}

/**
 * Vendor family slugs some SDK chip manifests carry in `families` instead of the
 * short SoM family slug (e.g. the i.MX 9 Murata radios tag `nxp-imx9`, not
 * `imx93`). Accept both so those chips are not invisible in the Configurator.
 */
const FAMILY_ALIASES: Record<string, string[]> = {
  imx93: ["nxp-imx9"],
};

export function chipsForSom(catalogue: SdkCatalogue, sku: string): ChipDef[] {
  const family = chipFamilyForSku(sku);
  if (!family) return [];
  const accepted = new Set([family, ...(FAMILY_ALIASES[family] ?? [])]);
  return catalogue.chips.filter((chip) =>
    chip.families.some((f) => accepted.has(f)),
  );
}
