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
  const carrier = record.carrier as Record<string, unknown> | undefined;
  const schemaVersion = (record.schema_version as number | undefined) ?? 1;

  let os: string | undefined;
  let coreIds: string[] | undefined;

  if (schemaVersion >= 2) {
    const cores = record.cores as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (cores) {
      coreIds = Object.keys(cores);
      const firstActive = Object.values(cores).find(
        (c) => c.os && c.os !== "off",
      );
      os = firstActive?.os as string | undefined;
    }
  } else {
    os = (record.os as string | undefined) ?? undefined;
  }

  return {
    sku: (som?.sku as string | undefined) ?? undefined,
    carrier: (carrier?.name as string | undefined) ?? undefined,
    os,
    ...(coreIds !== undefined && { coreIds }),
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
  if (summary.carrier) parts.push(summary.carrier);
  if (summary.coreIds && summary.coreIds.length > 1) {
    parts.push(`${summary.coreIds.length} cores`);
  } else if (summary.os) {
    parts.push(summary.os);
  }

  return {
    text: `$(circuit-board) ${parts.join(" · ")}`,
    tooltip: "Click to open the Alp board configurator.",
    command: "alp.openConfigurator",
  };
}
