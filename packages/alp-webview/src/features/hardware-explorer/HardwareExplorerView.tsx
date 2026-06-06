// SPDX-License-Identifier: Apache-2.0

import { useId, useState } from "react";
import { Button, EmptyState, Icon, Skeleton } from "../../shared/ui";
import type { ExplorerCore, ExplorerTopologyCore } from "../../types";
import styles from "./HardwareExplorerView.module.css";
import { useHardwareExplorer } from "./useHardwareExplorer";

export function HardwareExplorerView() {
  const { som, cores, sdkConnected, loading, reload } = useHardwareExplorer();
  const searchId = useId();
  const [padFilter, setPadFilter] = useState("");

  if (loading) {
    return (
      <div className={styles.container}>
        <Skeleton height={24} />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (!sdkConnected || som === null) {
    return (
      <EmptyState
        icon={<Icon name="plug" size={28} />}
        title={sdkConnected ? "No SoM configured" : "SDK not connected"}
        description={
          sdkConnected
            ? "Open a project with a board.yaml that specifies a SoM SKU."
            : "Connect or install an Alp SDK to explore hardware details."
        }
        action={
          <Button appearance="secondary" onClick={reload}>
            Reload
          </Button>
        }
      />
    );
  }

  const filteredRoutes = padFilter
    ? som.padRoutes.filter(
        (r) =>
          r.e1m.toLowerCase().includes(padFilter.toLowerCase()) ||
          r.dispatch.toLowerCase().includes(padFilter.toLowerCase()) ||
          (r.doc ?? "").toLowerCase().includes(padFilter.toLowerCase()),
      )
    : som.padRoutes;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.sku}>{som.sku}</span>
        <span className={styles.family}>{som.displayName}</span>
        <button
          type="button"
          className={styles.reloadBtn}
          onClick={reload}
          aria-label="Reload hardware data"
        >
          Reload
        </button>
      </div>

      {/* Compute — SoC cores */}
      {cores.length > 0 && (
        <section className={styles.section} aria-labelledby="compute-title">
          <h3 id="compute-title" className={styles.sectionTitle}>
            Compute
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Core ID</th>
                <th>Type</th>
                <th>Count</th>
                <th>Freq (MHz)</th>
              </tr>
            </thead>
            <tbody>
              {cores.map((c: ExplorerCore) => (
                <tr key={c.id}>
                  <td className={styles.mono}>{c.id}</td>
                  <td>{c.type}</td>
                  <td>{c.count}</td>
                  <td>{c.freqMhz ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Topology */}
      {som.topology.length > 0 && (
        <section className={styles.section} aria-labelledby="topology-title">
          <h3 id="topology-title" className={styles.sectionTitle}>
            Topology
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Core</th>
                <th>App</th>
                <th>Toolchain</th>
              </tr>
            </thead>
            <tbody>
              {som.topology.map((t: ExplorerTopologyCore) => (
                <tr key={t.id}>
                  <td className={styles.mono}>{t.id}</td>
                  <td className={styles.mono}>{t.app ?? "—"}</td>
                  <td>{t.toolchain ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* On-module chips */}
      {som.onModule.length > 0 && (
        <section className={styles.section} aria-labelledby="chips-title">
          <h3 id="chips-title" className={styles.sectionTitle}>
            On-module chips
          </h3>
          <div
            className={styles.chipList}
            role="list"
            aria-label="On-module chips"
          >
            {som.onModule.map((id) => (
              <span key={id} className={styles.chip} role="listitem">
                {id}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* E1M pad routes */}
      {som.padRoutes.length > 0 && (
        <section className={styles.section} aria-labelledby="routes-title">
          <h3 id="routes-title" className={styles.sectionTitle}>
            E1M pad routes{" "}
            <span className={styles.badge}>{som.padRoutes.length}</span>
          </h3>
          <div className={styles.searchRow}>
            <label htmlFor={searchId} className="sr-only">
              Filter pad routes
            </label>
            <input
              id={searchId}
              type="search"
              className={styles.searchInput}
              placeholder="Filter by signal, chip, or description…"
              value={padFilter}
              onChange={(e) => setPadFilter(e.target.value)}
              aria-label="Filter pad routes"
            />
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>E1M signal</th>
                <th>Dispatch</th>
                <th>Pin</th>
                <th>Doc</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoutes.map((r, i) => (
                <tr key={`${r.e1m}-${i}`}>
                  <td className={styles.mono}>{r.e1m}</td>
                  <td className={styles.mono}>{r.dispatch}</td>
                  <td>{r.dispatchPin ?? "—"}</td>
                  <td>{r.doc ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* I2C devices */}
      {som.i2cDevices.length > 0 && (
        <section className={styles.section} aria-labelledby="i2c-title">
          <h3 id="i2c-title" className={styles.sectionTitle}>
            I2C devices
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Bus</th>
                <th>Chip</th>
                <th>Role</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {som.i2cDevices.map((d, i) => (
                <tr key={`${d.bus}-${d.chip}-${i}`}>
                  <td className={styles.mono}>{d.bus}</td>
                  <td className={styles.mono}>{d.chip}</td>
                  <td>{d.role ?? "—"}</td>
                  <td className={styles.mono}>{d.address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
