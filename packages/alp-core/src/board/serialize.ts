// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardConfig, BOARD_KEY_ORDER } from "./models";

/**
 * Emit a board.yaml document. Keys are written in the canonical
 * board.schema.json order; keys whose value is undefined are omitted. Comments
 * and original formatting are not preserved (the SDK normalizes board.yaml on
 * load), but the data round-trips: parseBoardConfig(serializeBoardConfig(cfg))
 * deep-equals cfg.
 */
export function serializeBoardConfig(cfg: BoardConfig): string {
  const ordered: Record<string, unknown> = {};
  for (const key of BOARD_KEY_ORDER) {
    const value = (cfg as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      ordered[key] = value;
    }
  }
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}
