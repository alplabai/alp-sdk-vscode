// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { BoardConfig } from "@alp-sdk/core/board/models";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";

export function loadBoardConfigFromFile(boardPath: string): BoardConfig {
  if (!fs.existsSync(boardPath)) {
    return { som: { sku: "" }, cores: {} };
  }
  return parseBoardConfig(fs.readFileSync(boardPath, "utf-8"));
}

export function saveBoardConfigToFile(boardPath: string, cfg: BoardConfig): void {
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });
  fs.writeFileSync(boardPath, serializeBoardConfig(cfg), "utf-8");
}
