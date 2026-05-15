import type { ChipState } from "../types";

const LABELS: Record<ChipState, string> = {
  ready: "Ready",
  "setup-required": "Setup Required",
  "not-installed": "Not Installed",
  "not-updated": "Not Updated",
};

const CSS: Record<ChipState, string> = {
  ready: "badge badge-ok",
  "setup-required": "badge badge-warn",
  "not-installed": "badge badge-err",
  "not-updated": "badge badge-warn",
};

interface Props {
  state: ChipState;
}

export function StatusChip({ state }: Props) {
  return <span className={CSS[state]}>{LABELS[state]}</span>;
}
