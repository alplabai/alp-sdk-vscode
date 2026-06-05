// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import { BoardModel } from "@alp-sdk/core/configurator/models";
import {
  createDefaultBoardModel,
  parseBoardModel,
} from "@alp-sdk/core/configurator/service";

/**
 * Read a board.yaml into the legacy `BoardModel` for the module-scaffold flow.
 *
 * SoM/carrier preset discovery used to live here (`loadPresetCatalogue` →
 * `loadSomSkus`), but it scanned a per-SKU subdirectory layout
 * (metadata/e1m_modules/E1M-<sku>/som.yaml) the SDK never shipped — it ships
 * flat E1M-<sku>.yaml files. The live configurator sources SoMs from
 * `loadSdkCatalogue` (correct flat scan) / `alp presets`, so that broken path
 * was removed (conformance Issue 2).
 */
export function loadBoardModel(boardPath: string): BoardModel {
  if (!fs.existsSync(boardPath)) {
    return createDefaultBoardModel();
  }

  const text = fs.readFileSync(boardPath, "utf-8");
  return parseBoardModel(text);
}
