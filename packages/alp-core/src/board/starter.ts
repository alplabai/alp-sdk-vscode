// SPDX-License-Identifier: Apache-2.0

import { BoardConfig, CoreEntry } from "./models";

/**
 * Build a minimal but valid v0.6 board.yaml config for a SoM SKU. The first
 * core id runs Zephyr with a placeholder app; the rest are off. When no core
 * ids are known (SDK not connected) a single "app" core is used. No preset /
 * inline routing is set, so the result passes validateBoardConfig and the user
 * picks a preset afterward in the configurator.
 */
export function buildStarterBoardConfig(
  sku: string,
  coreIds: string[],
): BoardConfig {
  const ids = coreIds.length > 0 ? coreIds : ["app"];
  const cores: Record<string, CoreEntry> = {};
  ids.forEach((id, index) => {
    cores[id] = index === 0 ? { os: "zephyr", app: "app" } : { os: "off" };
  });
  return {
    name: boardNameFromSku(sku),
    som: { sku },
    cores,
  };
}

function boardNameFromSku(sku: string): string {
  const stem = sku
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const base = /^[A-Za-z]/.test(stem) ? stem : stem ? `board_${stem}` : "board";
  return base.endsWith("_project") ? base : `${base}_project`;
}
