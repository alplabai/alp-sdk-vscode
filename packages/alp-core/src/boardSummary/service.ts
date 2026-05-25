// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardSummary, StatusBarPresentation } from "./models";

export function parseBoardSummary(text: string): BoardSummary | null {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const som = record.som as Record<string, unknown> | undefined;
  return {
    sku: (som?.sku as string | undefined) ?? undefined,
    preset: (record.preset as string | undefined) ?? undefined,
  };
}

export function createStatusBarPresentation(
  summary: BoardSummary | null,
): StatusBarPresentation {
  if (!summary?.sku) {
    return {
      text: "$(circuit-board) Alp: no board.yaml",
      tooltip:
        "Open the board configurator with `Alp: Open board configurator`.",
      command: "alp.openConfigurator",
    };
  }

  const parts = [summary.sku];
  if (summary.preset) parts.push(summary.preset);

  return {
    text: `$(circuit-board) ${parts.join(" · ")}`,
    tooltip: "Click to open the Alp board configurator.",
    command: "alp.openConfigurator",
  };
}
