// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardConfig, BOARD_KEY_ORDER, CoreEntry } from "./models";

/**
 * Map a v0.6 board.yaml document onto the typed model. Only schema-known
 * top-level keys are copied (board.schema.json is additionalProperties:false,
 * so a valid file has no others). `som` and `cores` always exist on the result
 * so callers never branch on undefined.
 */
export function parseBoardConfig(text: string): BoardConfig {
  const d = (yaml.load(text) ?? {}) as Record<string, unknown>;

  const som = (d.som ?? {}) as Record<string, unknown>;
  const cfg: BoardConfig = {
    som: { sku: typeof som.sku === "string" ? som.sku : "" },
    cores: (d.cores ?? {}) as Record<string, CoreEntry>,
  };
  if (typeof som.hw_rev === "string") cfg.som.hw_rev = som.hw_rev;

  for (const key of BOARD_KEY_ORDER) {
    if (key === "som" || key === "cores") continue;
    if (d[key] !== undefined && d[key] !== null) {
      (cfg as unknown as Record<string, unknown>)[key] = d[key];
    }
  }
  return cfg;
}
