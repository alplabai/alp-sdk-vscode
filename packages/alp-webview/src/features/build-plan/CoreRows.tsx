// SPDX-License-Identifier: Apache-2.0
//
// The "Cores" section: one row per manifest slice — status, name, the two
// footprint meters, and the Flash action — with everything else one
// disclosure down. A slice that did not build says why on its own row, in
// the producer's words; there is no separate list of problems to go looking
// in.

import { Fragment, useId, useState } from "react";
import { Icon } from "../../shared/ui";
import type { ManifestSlice, SliceSize } from "../../types";
import { coreRowOf, type CoreMeter, type CoreRow } from "./coreRowModel";
import styles from "./rows.module.css";

function Meter({ meter, series }: { meter: CoreMeter; series: number }) {
  const status =
    meter.verdict === "over budget"
      ? "over"
      : meter.verdict === "near budget"
        ? "warn"
        : undefined;
  return (
    <div className={styles.meter}>
      <div className={styles.meterLine} data-status={status}>
        <span>
          <span className={styles.meterLabel}>{meter.label} </span>
          {meter.usedText}
          {meter.totalText !== null && (
            <span className={styles.meterLabel}> of {meter.totalText}</span>
          )}
        </span>
        {meter.pct !== null && (
          <span className={styles.meterPct}>
            {meter.verdict && `${meter.verdict} · `}
            {meter.pct}%
          </span>
        )}
      </div>
      {meter.pct !== null && (
        <div
          className={styles.track}
          role="meter"
          aria-label={`${meter.label} ${meter.pct}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(meter.pct, 100)}
        >
          <div
            className={styles.fill}
            data-series={series}
            data-status={status}
            style={{ width: `${Math.min(meter.pct, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  series,
  flashSlice,
  selected,
  onLocate,
}: {
  row: CoreRow;
  series: number;
  flashSlice: (coreId: string) => void;
  /** True while this core's slot is the one picked on the memory strip. */
  selected: boolean;
  /** Picks this core's slot on the memory strip; absent when the core has
   *  no placed slot to point at. */
  onLocate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ident = (
    <>
      <span className={styles.name}>{row.id}</span>
      <span className={styles.sub}>{row.subtitle}</span>
    </>
  );
  return (
    <li className={styles.item} data-selected={selected || undefined}>
      {/* The whole row picks the core's slot on the strip, not just its
          name: a pointer convenience over the name button, which stays the
          keyboard path. Clicks on the row's own controls (the disclosure,
          Flash) are theirs. `data-keep-selection` stops the page's
          background click from clearing the pick this click just made. */}
      <div
        className={styles.row}
        data-locatable={onLocate ? "" : undefined}
        data-keep-selection={onLocate ? "" : undefined}
        onClick={
          onLocate
            ? (e) => {
                if ((e.target as Element).closest("button, a")) return;
                if (window.getSelection?.()?.toString()) return;
                onLocate();
              }
            : undefined
        }
      >
        <div className={styles.lead}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${row.id} details`}
            onClick={() => setOpen((cur) => !cur)}
          >
            <span className={styles.toggleIcon} data-open={open || undefined}>
              <Icon name="chevronRight" size={12} />
            </span>
          </button>
          <span
            className={styles.dot}
            data-kind={row.statusKind}
            role="img"
            aria-label={row.statusLabel}
            title={row.statusLabel}
          />
          {onLocate ? (
            // The name is the handle: clicking it shows where this core's
            // image sits on the memory strip below.
            <button
              type="button"
              className={styles.ident}
              data-locate=""
              aria-current={selected || undefined}
              aria-label={`Show ${row.id} on the memory strip`}
              onClick={onLocate}
            >
              {ident}
            </button>
          ) : (
            <div className={styles.ident}>{ident}</div>
          )}
        </div>
        <div className={styles.body}>
          {row.problem !== null ? (
            <p className={styles.problem} data-kind={row.statusKind}>
              <Icon name="warning" size={14} className={styles.problemIcon} />
              <span>
                {row.statusLabel} — {row.problem}
              </span>
            </p>
          ) : row.meters !== null ? (
            <div className={styles.meters}>
              {row.meters.map((m) => (
                <Meter key={m.label} meter={m} series={series} />
              ))}
            </div>
          ) : (
            <span className={styles.status} data-kind={row.statusKind}>
              {row.measureNote ?? row.statusLabel}
            </span>
          )}
        </div>
        {row.flashable && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghostBtn}
              title={`Flash ${row.id}`}
              onClick={() => flashSlice(row.id)}
            >
              <Icon name="bolt" size={12} />
              Flash
            </button>
          </div>
        )}
      </div>
      {open && (
        <dl className={styles.details}>
          {row.details.map((d, i) => (
            // A flash argument may repeat a label another detail used
            // (`target`), so the index keeps the key unique.
            <Fragment key={`${d.label}:${i}`}>
              <dt>{d.label}</dt>
              <dd data-prose={d.prose || undefined}>{d.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </li>
  );
}

export function CoreRows({
  slices,
  sizeByCore,
  seriesByCore,
  sizesError,
  flashSlice,
  selectedCore,
  onLocate,
}: {
  slices: ManifestSlice[];
  sizeByCore: ReadonlyMap<string, SliceSize>;
  /** The chart series each core's slot is drawn in on the memory strip. */
  seriesByCore: ReadonlyMap<string, number>;
  /** Why `tan size` produced nothing, verbatim; null when it did. */
  sizesError: string | null;
  flashSlice: (coreId: string) => void;
  /** The core whose slot is picked on the memory strip, if any. */
  selectedCore: string | null;
  /** Picks a core's slot on the memory strip; only cores with a placed
   *  slot get one, so it returns null for the rest. */
  onLocate: (coreId: string) => (() => void) | null;
}) {
  const rows = slices.map((s) => coreRowOf(s, sizeByCore.get(s.core_id)));
  const active = slices.filter((s) => s.os !== "off").length;
  const built = slices.filter((s) => s.status === "ok").length;
  // Per-instance: an IDREF resolves against the whole document, and the
  // render harness mounts several panels into one.
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          Cores
        </h2>
        <span className={styles.sectionNote}>
          {built} of {active} built
        </span>
      </div>
      {sizesError !== null && (
        <p className={styles.problem} data-kind="warn">
          <Icon name="warning" size={14} className={styles.problemIcon} />
          <span>Footprints could not be measured — {sizesError}</span>
        </p>
      )}
      <ul className={styles.list}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            series={seriesByCore.get(row.id) ?? 1}
            flashSlice={flashSlice}
            selected={row.id === selectedCore}
            onLocate={onLocate(row.id) ?? undefined}
          />
        ))}
      </ul>
    </section>
  );
}
