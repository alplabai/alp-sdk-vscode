import { Button, Skeleton } from "../../shared/ui";
import type { DoctorCheckStatus } from "../../types";
import styles from "./ToolchainDoctorView.module.css";
import { useToolchainDoctor } from "./useToolchainDoctor";

const GLYPH: Record<DoctorCheckStatus, string> = {
  ok: "✓",
  warn: "!",
  missing: "✕",
};

export function ToolchainDoctorView() {
  const { report, loading, reload, runFix } = useToolchainDoctor();

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>Toolchain Doctor</h1>
          <p className={styles.subtitle}>
            Checks the build tools the Alp SDK needs (Python, west, CMake,
            Ninja, Zephyr SDK…) and offers one-click fixes.
          </p>
          <div className={styles.summaryRow}>
            <span
              className={styles.summary}
              data-status={loading ? "loading" : report?.ok ? "ok" : "missing"}
              role="status"
              aria-busy={loading || undefined}
            >
              {loading
                ? "Running checks…"
                : report?.ok
                  ? "All required tools present"
                  : `${report?.missingRequired ?? 0} required item(s) missing`}
            </span>
            <Button appearance="secondary" onClick={reload} disabled={loading}>
              Re-run
            </Button>
          </div>
        </header>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.skeletons}>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <ul className={styles.list}>
              {report?.checks.map((check) => (
                <li
                  key={check.id}
                  className={styles.row}
                  data-status={check.status}
                >
                  <span
                    className={styles.glyph}
                    data-status={check.status}
                    aria-hidden="true"
                  >
                    {GLYPH[check.status]}
                  </span>
                  <div className={styles.info}>
                    <div className={styles.label}>
                      {check.label}
                      {!check.required && (
                        <span className={styles.recommended}>recommended</span>
                      )}
                    </div>
                    <div className={styles.detail}>{check.detail}</div>
                  </div>
                  {check.fixId && (
                    <Button
                      appearance="primary"
                      onClick={() => runFix(check.fixId!)}
                    >
                      Fix
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
