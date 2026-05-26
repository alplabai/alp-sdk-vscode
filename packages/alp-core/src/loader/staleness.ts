// SPDX-License-Identifier: Apache-2.0

export type GenerationStatus = "current" | "stale" | "missing";

export interface GenerationStalenessInput {
  emit: string;
  displayName: string;
  generatedMtimeMs: number | null;
}

export interface GenerationStalenessEntry {
  emit: string;
  displayName: string;
  status: GenerationStatus;
}

export interface GenerationStalenessReport {
  entries: GenerationStalenessEntry[];
  stale: number;
  missing: number;
  ok: boolean;
}

/**
 * Classify each generated file against board.yaml's mtime. A null
 * generatedMtimeMs means the file is absent (missing). A file older than
 * board.yaml is stale. When boardMtimeMs is null (no board.yaml) an existing
 * file is treated as current — there's nothing newer to compare against. Pure.
 */
export function analyzeGenerationStaleness(
  boardMtimeMs: number | null,
  files: GenerationStalenessInput[],
): GenerationStalenessReport {
  const entries: GenerationStalenessEntry[] = files.map((file) => {
    let status: GenerationStatus;
    if (file.generatedMtimeMs === null) {
      status = "missing";
    } else if (boardMtimeMs !== null && boardMtimeMs > file.generatedMtimeMs) {
      status = "stale";
    } else {
      status = "current";
    }
    return { emit: file.emit, displayName: file.displayName, status };
  });

  const stale = entries.filter((e) => e.status === "stale").length;
  const missing = entries.filter((e) => e.status === "missing").length;
  return { entries, stale, missing, ok: stale === 0 && missing === 0 };
}
