// SPDX-License-Identifier: Apache-2.0

export interface BoardSummary {
  sku?: string;
  carrier?: string;
  os?: string;
}

export interface StatusBarPresentation {
  text: string;
  tooltip: string;
  command: string;
}
