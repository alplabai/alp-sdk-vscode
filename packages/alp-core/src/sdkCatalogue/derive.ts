// SPDX-License-Identifier: Apache-2.0

import {
  AcceleratorAvail,
  BoardPreset,
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
