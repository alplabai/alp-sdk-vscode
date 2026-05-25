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

export function boardsForSom(catalogue: SdkCatalogue, sku: string): BoardPreset[] {
  const som = somBySku(catalogue, sku);
  if (!som) return [];
  return catalogue.boards.filter((b) => b.hostsSomFamilies.includes(som.family));
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
    { id: "deepx_dxm1", label: "DeepX DX-M1", available: hasDeepx || pb === "deepx_dxm1" },
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

export function chipsForSom(catalogue: SdkCatalogue, sku: string): ChipDef[] {
  const family = chipFamilyForSku(sku);
  if (!family) return [];
  return catalogue.chips.filter((chip) => chip.families.includes(family));
}
