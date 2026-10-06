// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel: one page, read top to bottom.
//
//   header        — the module, the carrier, the silicon; when the manifest
//                   was written and whether a later build left it behind
//   Plan          — only when `tan build --plan` answers (never at this pin)
//   Cores         — one row per slice: status, footprint meters, Flash
//   Memory        — the address strip, the selected item's exact figures
//   Interconnect  — one row per IPC link, a blocked one with its reason
//   Helper MCUs   — the module's companion controllers
//   footer        — where the data came from
//
// Every problem sits on the row it is about — a skipped core's reason, a
// blocked link's, a stale manifest under the header — so there is no
// separate list of them to cross-reference. Refresh, Build and Materialise
// are the panel's editor-title commands (`alp.buildPlan.*` in package.json),
// not buttons here: VS Code's own toolbar is where a panel's actions go.

import { useRef, useState, type ReactNode } from "react";
import { EmptyState, Icon, Skeleton } from "../../shared/ui";
import type {
  ManifestHwInfo,
  ManifestProvenance,
  SliceSize,
} from "../../types";
import { postMessage } from "../../vscode";
import styles from "./BuildPlanView.module.css";
import { CoreRows } from "./CoreRows";
import { HelperMcuRows } from "./HelperMcuRows";
import { InterconnectRows } from "./InterconnectRows";
import { MemoryStrip } from "./MemoryStrip";
import { seriesByLabel } from "./stripLayout";
import { PlanRows } from "./PlanRows";
import { useBuildPlan } from "./useBuildPlan";

/** The manifest, as the reader refers to it. */
const MANIFEST_PATH = "build/system-manifest.yaml";

/**
 * How long ago the manifest was written, in words (#470).
 *
 * Relative, not an absolute stamp: "3 days ago" answers "can I trust this?"
 * at a glance, where a timestamp makes the reader do the subtraction. Rounded
 * DOWN at every step, so it can never overstate how fresh the file is.
 */
export function writtenAgo(iso: string, now = Date.now()): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const seconds = Math.floor((now - at) / 1000);
  // A negative age means the file is dated ahead of this clock; the host
  // already renders that as `unknown` with its own sentence, so say nothing
  // rather than print "in -2 minutes".
  if (seconds < 0) return null;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Identity({ hw }: { hw: ManifestHwInfo }) {
  return (
    <p className={styles.identity}>
      <span className={styles.mono}>{hw.sku}</span>
      {hw.som_hw_rev && ` ${hw.som_hw_rev}`}
      {hw.board_name && (
        <>
          {" on "}
          <span className={styles.mono}>{hw.board_name}</span>
          {hw.board_hw_rev && ` ${hw.board_hw_rev}`}
        </>
      )}
      {hw.silicon && (
        <>
          {" · "}
          <span className={styles.mono}>{hw.silicon}</span>
        </>
      )}
    </p>
  );
}

/** One line under the identity: the file's age and the host's verdict on it.
 *  `stale` is a claim with evidence (a build finished after the file was
 *  written and did not update it) and carries the host's own sentence;
 *  `unknown` says what it does not know rather than passing for fresh. */
function Freshness({ provenance }: { provenance: ManifestProvenance }) {
  const age = provenance.writtenAt ? writtenAgo(provenance.writtenAt) : null;
  const written = age ? `Written ${age}` : "Written at an unknown time";
  // One short line; the host's own sentence stays one click away, verbatim.
  // Printed in full it wrapped to a two-line paragraph above everything else.
  const verdict =
    provenance.freshness === "fresh"
      ? "by the last build."
      : provenance.freshness === "stale"
        ? "· a later build did not update it."
        : "· no build has been observed since.";
  return (
    <div className={styles.freshness} data-freshness={provenance.freshness}>
      <Icon
        name={provenance.freshness === "stale" ? "warning" : "activity"}
        size={14}
        className={styles.freshnessIcon}
      />
      {provenance.reason ? (
        <details className={styles.why}>
          <summary>
            {written} {verdict}
          </summary>
          <p>{provenance.reason}</p>
        </details>
      ) : (
        <span>
          {written} {verdict}
        </span>
      )}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className={styles.freshness} data-kind="err">
      <Icon name="warning" size={14} className={styles.freshnessIcon} />
      <span>{text}</span>
    </p>
  );
}

/** What a click may land on without clearing the memory selection. */
const KEEPS_SELECTION =
  "button, a, summary, input, select, textarea, [data-keep-selection]";

const URL_RE = /(https:\/\/[^\s)]+)/g;

/** A note with its URLs made clickable — a webview cannot open a link on its
 *  own, so each goes through the host's `openUrl`. */
function Linkified({ text }: { text: string }): ReactNode {
  return text.split(URL_RE).map((part, i) =>
    URL_RE.test(part) ? (
      <a
        key={i}
        href={part}
        onClick={(e) => {
          e.preventDefault();
          postMessage({ type: "openUrl", url: part, label: part });
        }}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export function BuildPlanView() {
  const {
    plan,
    error,
    loading,
    manifest,
    manifestProvenance,
    manifestError,
    memory,
    sizes,
    sizesError,
    flashSlice,
  } = useBuildPlan();
  const sizeByCore = new Map<string, SliceSize>(
    (sizes?.slices ?? []).map((s) => [s.core_id, s]),
  );
  // The chart series each core's slot is drawn in, so the core row's meters
  // and the strip's box share a colour.
  const seriesByCore = memory ? seriesByLabel(memory.spans) : new Map();
  // Said once, in the footer: why there is no live plan. At this pin `tan
  // build --plan` is retired (tan-cli#427), so the whole page reads from the
  // last build's manifest, and the sentence saying so is context, not an
  // alarm.
  const planNote = plan ? null : error;

  // The memory strip's selection lives here so a core row can drive it: a
  // click on a core's name picks that core's slot, and the core whose slot
  // is picked is marked in the list.
  const [memoryPick, setMemoryPick] = useState<string | null | undefined>(
    undefined,
  );
  const memoryRef = useRef<HTMLDivElement>(null);
  const slotByCore = new Map(
    (memory?.spans ?? [])
      .filter((s) => s.kind === "slot_image" && s.base !== null)
      .map((s) => [s.label, s.id] as const),
  );
  const pickedCore =
    [...slotByCore].find(([, id]) => id === memoryPick)?.[0] ?? null;
  // A click on empty space, or Escape, clears the selection — the way a
  // click on the Explorer's background deselects. Controls, links, the
  // disclosures and the detail line (where a reader selects a hex to copy)
  // keep it, and so does a click that ends a text selection.
  const clearOnBackground = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest(KEEPS_SELECTION)) return;
    if (window.getSelection?.()?.toString()) return;
    setMemoryPick(null);
  };
  const clearOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setMemoryPick(null);
  };
  const locateCore = (coreId: string) => {
    const slot = slotByCore.get(coreId);
    if (slot === undefined) return null;
    return () => {
      setMemoryPick(slot);
      // `nearest`: no jump when the strip is already on screen. Optional
      // call: jsdom (the render harness) has no scrollIntoView.
      memoryRef.current?.scrollIntoView?.({ block: "nearest" });
    };
  };

  return (
    // Pointer and Escape conveniences only: every selection is also made
    // and changed with the keyboard on the strip itself.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className={styles.root}
      onClick={clearOnBackground}
      onKeyDown={clearOnEscape}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Build Plan</h1>
        {manifest && <Identity hw={manifest.hw_info} />}
        {manifest && manifestProvenance && (
          <Freshness provenance={manifestProvenance} />
        )}
        {manifestError && (plan || manifest) && (
          <ErrorLine text={manifestError} />
        )}
      </header>

      {loading ? (
        <div className={styles.skeletons}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : !plan && !manifest ? (
        <EmptyState
          icon={<Icon name="cpu" size={28} />}
          title="No build yet"
          description={
            manifestError ??
            error ??
            `Run a build to write ${MANIFEST_PATH}; this panel reads it.`
          }
        />
      ) : (
        <div className={styles.sections}>
          {plan && <PlanRows plan={plan} />}
          {manifest && (
            <CoreRows
              slices={manifest.slices}
              sizeByCore={sizeByCore}
              seriesByCore={seriesByCore}
              sizesError={sizesError}
              flashSlice={flashSlice}
              selectedCore={pickedCore}
              onLocate={locateCore}
            />
          )}
          {manifest && memory && (
            <div ref={memoryRef}>
              <MemoryStrip
                memory={memory}
                budgets={sizeByCore}
                sku={manifest.hw_info.sku}
                picked={memoryPick}
                onPick={setMemoryPick}
              />
            </div>
          )}
          {manifest && manifest.ipc.length > 0 && (
            <InterconnectRows
              links={manifest.ipc}
              spans={memory?.spans ?? []}
            />
          )}
          {manifest && manifest.helper_mcus.length > 0 && (
            <HelperMcuRows mcus={manifest.helper_mcus} />
          )}
        </div>
      )}

      {!loading && (plan || manifest) && (
        <footer className={styles.footer}>
          {manifest && (
            <>
              Read from <span className={styles.mono}>{MANIFEST_PATH}</span>
              {manifest.generated_by && (
                <>
                  , written by{" "}
                  <span className={styles.mono}>{manifest.generated_by}</span>
                </>
              )}
              .{" "}
            </>
          )}
          {planNote && (
            // Context, not an alarm: the summary says it in a clause, the
            // producer's full sentence opens beneath it.
            <details className={styles.why}>
              <summary>No live plan preview at this tan version.</summary>
              <p>
                <Linkified text={planNote} />
              </p>
            </details>
          )}
        </footer>
      )}
    </div>
  );
}
