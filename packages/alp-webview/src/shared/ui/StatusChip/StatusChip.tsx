import type { ChipState } from "../../../types";
import styles from "./StatusChip.module.css";

const LABELS: Record<ChipState, string> = {
  ready: "Ready",
  "setup-required": "Action Required",
  "not-installed": "Missing",
  "not-updated": "Update Needed",
};

interface Props {
  state: ChipState;
}

export function StatusChip({ state }: Props) {
  return (
    <span className={styles.badge} data-variant={state}>
      {LABELS[state]}
    </span>
  );
}
