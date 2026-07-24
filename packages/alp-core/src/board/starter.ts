// SPDX-License-Identifier: Apache-2.0

import { BoardConfig, CoreEntry } from "./models";

/**
 * Derive a schema-valid board `name` from a SoM SKU. The board schema pins
 * `name` to `^[A-Za-z][A-Za-z0-9_-]*$`, so a raw `${sku} project` (with its
 * space, and any punctuation a SKU carries) is rejected by the vendored
 * board.schema.json. Collapse disallowed runs to `-`, drop leading non-letters
 * and trailing separators, and fall back to a constant when nothing survives.
 */
export function starterBoardName(sku: string): string {
  const cleaned = sku
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[-_]+$/g, "");
  return cleaned ? `${cleaned}-project` : "board-project";
}

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
    name: starterBoardName(sku),
    som: { sku },
    cores,
  };
}
