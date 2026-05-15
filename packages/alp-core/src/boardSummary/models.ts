// SPDX-License-Identifier: Apache-2.0

export interface BoardSummary {
  sku?: string;
  carrier?: string;
  /** First non-off core OS for v2 documents; top-level os for v1. */
  os?: string;
  /** Core IDs declared in the `cores:` block (v2 only). */
  coreIds?: string[];
}

export interface StatusBarPresentation {
  text: string;
  tooltip: string;
  command: string;
}
