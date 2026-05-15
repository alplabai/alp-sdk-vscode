// SPDX-License-Identifier: Apache-2.0

import { BoardSummary } from "./models";
import { parseBoardSummary } from "./service";

export interface BoardSummaryAdapterDependencies {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  log(line: string): void;
}

export function loadBoardSummaryWithDependencies(
  boardYamlPath: string | null,
  dependencies: BoardSummaryAdapterDependencies,
): BoardSummary | null {
  if (!boardYamlPath || !dependencies.existsSync(boardYamlPath)) {
    return null;
  }

  try {
    return parseBoardSummary(dependencies.readFileSync(boardYamlPath, "utf-8"));
  } catch (error) {
    dependencies.log(`statusBar: failed to parse ${boardYamlPath}: ${error}`);
    return null;
  }
}
