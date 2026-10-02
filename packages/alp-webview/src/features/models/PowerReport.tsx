// SPDX-License-Identifier: Apache-2.0

import type { ModelPowerData, ModelPowerResultMessage } from "../../types";
import styles from "./ModelsView.module.css";

/** A missing figure is "n/a", never 0 — the CLI sends null when it could not
 *  derive a value, and a fabricated zero would read as a real measurement. */
export function fmt(v: number | null | undefined, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toFixed(digits)
    : "n/a";
}

/** Power result card: issues (warnings included), then the per-rail table and
 *  run summary. Thin — every number comes from the CLI envelope. */
export function PowerReport({
  ok,
  power,
  issues,
}: {
  ok: boolean;
  power: ModelPowerData | null;
  issues: ModelPowerResultMessage["issues"];
}) {
  const shown =
    !ok && issues.length === 0
      ? [
          {
            code: "power.failed",
            severity: "error",
            message: "Power measurement failed (no diagnostic).",
          },
        ]
      : issues;
  return (
    <div className={styles.issues} data-ok={ok} role={ok ? undefined : "alert"}>
      <p className={styles.issuesHead}>
        {ok ? "Power result" : "Power measurement failed"}
      </p>
      {shown.length > 0 && (
        <ul className={styles.issuesList}>
          {shown.map((issue, i) => (
            <li key={`${issue.code}-${i}`} data-severity={issue.severity}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {ok && power && (
        <>
          <p className={styles.suggestion}>
            source: {power.source} · inferences: {power.inferences} · latency
            median {fmt(power.latency_us?.median, 1)} µs / p90{" "}
            {fmt(power.latency_us?.p90, 1)} µs · dropped: {power.dropped}
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rail</th>
                <th>Part @ addr</th>
                <th>Idle (mW)</th>
                <th>Active (mW)</th>
                <th>mJ / inference</th>
                <th>Gross mJ / inference</th>
              </tr>
            </thead>
            <tbody>
              {power.rails.map((r) => (
                <tr key={`${r.name}-${r.addr}`}>
                  <td>{r.name}</td>
                  <td className={styles.mono}>
                    {r.part}@{r.addr}
                  </td>
                  <td>{fmt(r.avg_idle_mw)}</td>
                  <td>{fmt(r.avg_active_mw)}</td>
                  <td>{fmt(r.energy_per_inference_mj, 3)}</td>
                  <td>{fmt(r.gross_energy_per_inference_mj, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {power.note && <p className={styles.hint}>{power.note}</p>}
        </>
      )}
    </div>
  );
}
