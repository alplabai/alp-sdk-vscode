// SPDX-License-Identifier: Apache-2.0

export interface BuildTarget {
  board: string;
  example: string;
}

/**
 * Returns a usable build target only when both fields are present after
 * trimming; otherwise null. Pure — used to validate remembered/prompted input.
 */
export function normalizeBuildTarget(
  raw: Partial<BuildTarget> | null | undefined,
): BuildTarget | null {
  if (!raw) return null;
  const board = (raw.board ?? "").trim();
  const example = (raw.example ?? "").trim();
  if (!board || !example) return null;
  return { board, example };
}
