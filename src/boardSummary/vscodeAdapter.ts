// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import { log } from "../util";
import { loadBoardSummaryWithDependencies } from "@alp-sdk/core/boardSummary/adapterCore";
import { BoardSummary } from "@alp-sdk/core/boardSummary/models";

export function loadBoardSummary(
  boardYamlPath: string | null,
): BoardSummary | null {
  return loadBoardSummaryWithDependencies(boardYamlPath, {
    existsSync: fs.existsSync,
    readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
    log,
  });
}
