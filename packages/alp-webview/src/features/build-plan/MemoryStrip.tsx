// SPDX-License-Identifier: Apache-2.0
//
// The "Memory" section: the address-space half of the manifest (#484) as
// ONE horizontal strip — SoM regions along the top lane, placed images along
// the lower lane, declared edges ticked underneath — and, beneath it, the
// selected item in full: exact range, size in both spellings, footprint,
// authority, and the producer's own reason where there is one.
//
// Entries the resolver did not place, and regions that resolve no extent,
// are drawn as dashed ghosts after the strip, never dropped: the reason they
// have no address is the one actionable half, and it is one click away.
//
// STILL READ-ONLY. `write_authority` is optional on both `som-preset-v1`
// and `system-manifest-v1` (promotion to required is alp-sdk#2024), so an
// editable affordance over a map that cannot always tell `storage` from
// `atoc` remains a live hazard — writing the ATOC can leave the part
// unbootable. `test/memoryRegions.readOnly.test.js` fails if this file or
// anything it imports grows a write path; the two host messages the ghosts
// send (open the board config, copy a reason) go through the one sanctioned
// module, `blockedFindingActions.ts`.

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../shared/ui";
import type { MemoryConflict, MemoryView, SliceSize } from "../../types";
import { TIER_LABEL, type AuthorityTier } from "./authorityTier";
import {
  BOARD_CONFIG_LABEL,
  copyFindingText,
  openDeclaringFile,
} from "./blockedFindingActions";
import { formatBytes, formatOffsetRange, formatRange } from "./format";
import {
  buildRows,
  buildUnplacedRows,
  unresolvedRegionRows,
  type Row,
  type UnplacedRow,
} from "./memoryRows";
import { CELL_PITCH_PX, CELL_ROWS, type CellFill } from "./slotUsage";
import {
  buildStrip,
  FALLBACK_STRIP_WIDTH,
  type StripModel,
} from "./stripLayout";
import styles from "./MemoryStrip.module.css";

const CONFLICT_TITLE: Record<MemoryConflict["kind"], string> = {
  overlap: "share addresses",
  covers_load_address: "covers an image load address",
  device_overlap: "overlap inside one flash device",
  outside_region: "lands outside the region it names",
};

/** The narrowest box that still holds its name, and the narrowest that
 *  holds its figure beneath the name; anything narrower keeps the text in
 *  its title and in the detail line instead of clipping it mid-glyph. */
const NAME_MIN_PX = 56;
const FIGURE_MIN_PX = 150;

/** The strip's own live width. 0 — no `ResizeObserver`, or one that has not
 *  fired yet — keeps the fallback, so a first paint still draws a strip. */
function useMeasuredWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width > 0 ? width : FALLBACK_STRIP_WIDTH;
}

/** Items a reader can select, in reading order: placed images left to
 *  right, then regions left to right, then the ghosts. One roving tab stop
 *  moves along it with the arrow keys. */
function selectableOrder(model: StripModel | null, ghosts: UnplacedRow[]) {
  const byLeft = (a: { left: number }, b: { left: number }) => a.left - b.left;
  const spans = model ? [...model.spans].sort(byLeft).map((s) => s.id) : [];
  const regions = model
    ? [...model.regions]
        .filter((r) => r.selectable)
        .sort(byLeft)
        .map((r) => r.id)
    : [];
  return [...spans, ...regions, ...ghosts.map((g) => g.id)];
}

function conflictText(c: MemoryConflict): string {
  const where =
    c.device !== null
      ? `${formatOffsetRange(c.from, c.to)} in ${c.device}`
      : formatRange(c.from, c.to);
  return `${c.first} and ${c.second}: ${CONFLICT_TITLE[c.kind]} · ${where}`;
}

function Pair({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.pair}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "Image slot", "Carve-out", "Partition" for a span; a region's own class
 *  word follows its name instead, since "Region" is the label. */
const capitalise = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

function RowDetail({ row }: { row: Row }) {
  return (
    <dl className={styles.detail} aria-live="polite" data-keep-selection="">
      {row.origin === "span" ? (
        <Pair label={capitalise(row.kindText)}>
          <span className={styles.mono}>{row.name}</span>
        </Pair>
      ) : (
        <Pair label="Region">
          <span className={styles.mono}>{row.name}</span> · {row.kindText}
        </Pair>
      )}
      <Pair label="Range">
        <span className={styles.mono}>{row.range}</span>
      </Pair>
      <Pair label="Size">
        {row.sizeText}
        {row.sizeHex && <span className={styles.hex}> {row.sizeHex}</span>}
        {row.sizeNote && ` · ${row.sizeNote}`}
      </Pair>
      {row.usedText && (
        <Pair label="Used">
          {row.usedText}
          {row.usedHex && <span className={styles.hex}> {row.usedHex}</span>}
          {/* Said once: when size and use share a source, the Size cell
              already named it. */}
          {row.usedNote &&
            row.usedNote !== row.sizeNote &&
            ` · ${row.usedNote}`}
        </Pair>
      )}
      {row.authorityText && <Pair label="Authority">{row.authorityText}</Pair>}
      {/* A slot named after its only core says nothing new in a Cores pair. */}
      {row.cores.length > 0 &&
        !(row.cores.length === 1 && row.cores[0] === row.name) && (
          <Pair label="Cores">
            <span className={styles.mono}>{row.cores.join(" ↔ ")}</span>
          </Pair>
        )}
      {row.note && <Pair label="Note">{row.note}</Pair>}
      {row.reason && <pre className={styles.reason}>{row.reason}</pre>}
    </dl>
  );
}

function GhostDetail({ ghost }: { ghost: UnplacedRow }) {
  // Only a board.yaml entry (an IPC carve-out, a storage partition) is the
  // reader's to edit; an unresolved SoM region is declared in the SoM
  // preset, so it gets the reason and no button.
  const declaredInBoardConfig = ghost.key.startsWith("unplaced:");
  const kind = ghost.statusText === "Blocked" ? "err" : "warn";
  return (
    <dl className={styles.detail} aria-live="polite" data-keep-selection="">
      <Pair label={ghost.kindText}>
        <span className={styles.mono}>{ghost.name}</span>
      </Pair>
      <Pair label="Status">{ghost.statusText}</Pair>
      {ghost.sizeText && <Pair label="Size">{ghost.sizeText}</Pair>}
      {ghost.cores.length > 0 && (
        <Pair label="Cores">
          <span className={styles.mono}>{ghost.cores.join(" ↔ ")}</span>
        </Pair>
      )}
      {ghost.reason ? (
        <pre className={styles.reason} data-kind={kind}>
          {ghost.reason}
        </pre>
      ) : (
        <Pair label="Reason">none reported</Pair>
      )}
      {declaredInBoardConfig && (
        <div className={styles.detailActions}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={openDeclaringFile}
          >
            Open {BOARD_CONFIG_LABEL}
          </button>
          {ghost.reason && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => copyFindingText(ghost.reason as string)}
            >
              Copy reason
            </button>
          )}
        </div>
      )}
    </dl>
  );
}

/** A slot's cells: lit from the base (left) column by column, each column
 *  from the bottom up. Decorative — the exact bytes are in the text above
 *  it and in the detail line — so it is hidden from assistive tech. */
function CellField({ cells }: { cells: CellFill }) {
  return (
    <span
      className={styles.cells}
      style={{
        width: cells.cols * CELL_PITCH_PX,
        height: CELL_ROWS * CELL_PITCH_PX,
      }}
      title={`${cells.filled} of ${cells.total} cells lit · one cell ≈ ${formatBytes(cells.bytesPerCell)}`}
      aria-hidden="true"
      data-filled={cells.filled}
    >
      <span
        className={styles.cellsLit}
        style={{ width: cells.fullCols * CELL_PITCH_PX }}
      />
      {cells.partial > 0 && (
        <span
          className={styles.cellsLit}
          style={{
            left: cells.fullCols * CELL_PITCH_PX,
            width: CELL_PITCH_PX,
            height: cells.partial * CELL_PITCH_PX,
          }}
        />
      )}
    </span>
  );
}

function Legend({ tiers }: { tiers: AuthorityTier[] }) {
  return (
    <ul className={styles.legend} aria-label="Write authority">
      {tiers.map((tier) => (
        <li key={tier}>
          <span
            className={styles.tierMark}
            data-tier={tier}
            data-legend=""
            aria-hidden="true"
          />
          {TIER_LABEL[tier]}
        </li>
      ))}
    </ul>
  );
}

export function MemoryStrip({
  memory,
  budgets,
  sku,
  picked: pickedFromOutside,
  onPick,
}: {
  memory: MemoryView;
  budgets: Map<string, SliceSize>;
  sku: string;
  /** The selection when the page owns it (with `onPick`) — a click on a
   *  core row picks that core's slot here. `undefined` selects the first
   *  placed image; `null` is "nothing selected", which the page sets when
   *  the reader clicks empty space or presses Escape. */
  picked?: string | null;
  onPick?: (id: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(stripRef);
  const uid = useId();
  const regions = memory.regions ?? [];
  const model = buildStrip(memory, budgets, width);
  const ghosts = [
    ...buildUnplacedRows(memory.unresolved),
    ...unresolvedRegionRows(regions),
  ];
  const order = selectableOrder(model, ghosts);
  const [pickedHere, setPickedHere] = useState<string | null | undefined>(
    undefined,
  );
  const picked = onPick ? pickedFromOutside : pickedHere;
  const setPicked = onPick ?? setPickedHere;
  // The first placed image is selected until the reader picks: the detail
  // line is where the exact figures live. Once the reader clears the
  // selection it stays clear, and the detail line says how to bring it back.
  const selected =
    picked === undefined
      ? order[0]
      : picked !== null && order.includes(picked)
        ? picked
        : null;
  const rows = buildRows(regions, memory.spans, budgets, selected ?? null);
  const selectedRow = rows.find((r) => r.selected) ?? null;
  const selectedGhost = ghosts.find((g) => g.id === selected) ?? null;
  const domId = (id: string) => `${uid}-${order.indexOf(id)}`;
  const moveTo = (id: string) => {
    setPicked(id);
    document.getElementById(domId(id))?.focus();
  };
  const onKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    const i = order.indexOf(id);
    const n = order.length;
    const target =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? order[(i + 1) % n]
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? order[(i - 1 + n) % n]
          : e.key === "Home"
            ? order[0]
            : e.key === "End"
              ? order[n - 1]
              : null;
    if (target === null) return;
    e.preventDefault();
    moveTo(target);
  };
  const itemProps = (id: string, label: string) => ({
    id: domId(id),
    type: "button" as const,
    "aria-pressed": id === selected,
    "aria-label": label,
    tabIndex: id === (selected ?? order[0]) ? 0 : -1,
    onClick: () => setPicked(id),
    onKeyDown: onKeyDown(id),
  });
  const tiersDrawn = model
    ? ([...new Set(model.regions.map((r) => r.tier))].filter(
        (t): t is AuthorityTier => t !== null,
      ) as AuthorityTier[])
    : [];
  const note =
    regions.length === 0
      ? `${sku} does not publish its memory regions yet, so only the slots this build placed are drawn.`
      : model && !model.tiered
        ? `${sku} does not publish write authority for these regions.`
        : null;
  // Partitions are placed but device-relative, so they have no x on an
  // address strip; they sit with the ghosts, solid-edged, selectable.
  const partitions = rows.filter((r) => r.origin === "span" && r.base === null);
  const headingId = `${uid}-heading`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          Memory
        </h2>
        {note && <span className={styles.sectionNote}>{note}</span>}
        {tiersDrawn.length > 0 && <Legend tiers={tiersDrawn} />}
      </div>
      {model ? (
        <div className={styles.strip} ref={stripRef} data-strip-width={width}>
          <div className={styles.lanes}>
            <div className={styles.axis} aria-hidden={true}>
              {model.segments.map((seg) => (
                <span
                  key={seg.lo}
                  className={styles.seg}
                  data-segment={seg.kind}
                  title={seg.gapLabel ?? undefined}
                  style={{ left: seg.left, width: seg.width }}
                />
              ))}
            </div>
            {model.regions.length > 0 && (
              <div
                className={styles.lane}
                data-lane="regions"
                role="group"
                aria-label="SoM regions"
              >
                {model.regions.map((r, i) => {
                  const row = rows.find((x) => x.id === r.id);
                  return (
                    // A duplicated region name shares its id with every
                    // other row of that name, so the key carries the index.
                    <button
                      key={`${r.id}:${i}`}
                      className={styles.region}
                      data-tier={r.tier ?? undefined}
                      title={r.title}
                      style={{ left: r.left, width: r.width }}
                      {...(r.selectable
                        ? itemProps(r.id, row?.accessibleName ?? r.title)
                        : {
                            type: "button" as const,
                            "aria-label": row?.accessibleName ?? r.title,
                            "aria-disabled": true,
                            tabIndex: -1,
                          })}
                    >
                      {r.width >= NAME_MIN_PX && r.name}
                      {r.tier && (
                        <span className={styles.tierMark} data-tier={r.tier} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div
              className={styles.lane}
              data-lane="placed"
              role="group"
              aria-label="Placed images"
            >
              {model.spans.map((s) => {
                const row = rows.find((x) => x.id === s.id);
                return (
                  <button
                    key={s.id}
                    className={styles.span}
                    data-series={s.series}
                    data-marker={s.marker || undefined}
                    title={s.title}
                    style={{ left: s.left, width: s.width }}
                    {...itemProps(s.id, row?.accessibleName ?? s.title)}
                  >
                    {s.marker ? (
                      <span className={styles.markerName}>{s.name}</span>
                    ) : (
                      <>
                        {s.width >= NAME_MIN_PX && (
                          <span className={styles.spanName}>{s.name}</span>
                        )}
                        {s.width >= FIGURE_MIN_PX && row?.usedText && (
                          <span className={styles.spanUse}>
                            {row.usedText}
                            {row.sizeHex && ` of ${row.sizeText}`}
                          </span>
                        )}
                      </>
                    )}
                    {s.cells !== null ? (
                      <CellField cells={s.cells} />
                    ) : (
                      s.usedPx !== null && (
                        <span
                          className={styles.used}
                          data-series={s.series}
                          style={{ width: s.usedPx }}
                          aria-hidden="true"
                        />
                      )
                    )}
                  </button>
                );
              })}
            </div>
            <div className={styles.ticks} aria-hidden="true">
              {model.ticks.map((t) => (
                // `data-address` names the declared edge each tick stands
                // on, so a test can prove every declared address reached
                // the strip without reading pixel positions back.
                <span key={t.address} data-address={t.address}>
                  <span className={styles.tick} style={{ left: t.lineX }} />
                  {t.labelled && (
                    <span className={styles.tickLabel} style={{ left: t.x }}>
                      {t.label}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.sectionNote}>
          This build pins no address range yet.
        </p>
      )}
      {(partitions.length > 0 || ghosts.length > 0) && (
        <ul className={styles.ghosts} aria-label="Not on the strip">
          {partitions.map((p) => (
            <li key={p.key}>
              <button
                className={styles.ghost}
                data-placed=""
                title={p.accessibleName}
                {...itemProps(p.id, p.accessibleName)}
              >
                {p.name}
                <span className={styles.ghostStatus}>· {p.range}</span>
              </button>
            </li>
          ))}
          {ghosts.map((g) => (
            <li key={g.key}>
              <button
                className={styles.ghost}
                title={g.accessibleName}
                {...itemProps(g.id, g.accessibleName)}
              >
                {g.name}
                <span
                  className={styles.ghostStatus}
                  data-kind={g.statusText === "Blocked" ? "err" : "warn"}
                >
                  · {g.statusText.toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {memory.conflicts.map((c) => (
        <p key={c.id} className={styles.problem}>
          <Icon name="warning" size={14} className={styles.problemIcon} />
          <span>{conflictText(c)}</span>
        </p>
      ))}
      {selectedRow ? (
        <RowDetail row={selectedRow} />
      ) : selectedGhost ? (
        <GhostDetail ghost={selectedGhost} />
      ) : order.length > 0 ? (
        <p className={styles.detailHint}>
          Select a slot or region for its exact range and size.
        </p>
      ) : null}
    </section>
  );
}
