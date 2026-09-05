import { useState } from "react";
import { Button, Card, EmptyState, Icon, Skeleton } from "../../shared/ui";
import type {
  BuildPlanGeneratedFile,
  BuildPlanSlice,
  ManifestProvenance,
  MemoryView,
  SizeReport,
  SliceSize,
  SystemManifest,
} from "../../types";
import styles from "./BuildPlanView.module.css";
import { formatBytes } from "./format";
import { MemoryRegions } from "./MemoryRegions";
import { useBuildPlan } from "./useBuildPlan";

function commandLine(slice: BuildPlanSlice): string {
  if (!slice.command) return "(no command — not buildable yet)";
  const { tool, args } = slice.command;
  return args.length > 0 ? `${tool} ${args.join(" ")}` : tool;
}

const isReady = (value?: string): boolean => !!value && value !== "TBD";

/** The system manifest — the resolved per-core contract (`alp build --manifest`):
 *  slices with their runtime + flash wiring, IPC links, and helper MCUs. The
 *  per-slice Flash button shows/hides straight from the manifest: it appears
 *  only when the slice carries a real `flash_method` (not the `TBD`
 *  placeholder). There is no per-slice Build button — `tan build` has no
 *  `--core` option, so building a single slice isn't a real CLI command. */
/** One region as `97.1 KiB / 5.50 MiB (1.7%)`, degrading honestly: a null
 *  `used` means nothing could measure it and a null `total` means no budget
 *  resolved. Neither is rendered as 0 — tan reports null rather than guessing,
 *  and a fabricated 0% would read as "plenty of room left". */
function regionLabel(region: SliceSize["flash"]): string {
  if (region.used === null) return "unknown";
  const used = formatBytes(region.used);
  if (region.total === null) return `${used} (no budget)`;
  const pct = region.pct === null ? "" : ` (${region.pct}%)`;
  return `${used} / ${formatBytes(region.total)}${pct}`;
}

/** Footprint for one slice, or null when `tan size` had no row for it. */
function SliceFootprint({ size }: { size: SliceSize | undefined }) {
  if (!size) return null;
  // A slice with no artefact yet, or one that cannot be measured at all, has
  // no numbers worth a row — say so instead of printing empty regions.
  if (size.status === "not-built" || size.status === "n/a") {
    return (
      <span className={styles.manifestDetail}>
        <span className={styles.sizeStatus} data-size-status={size.status}>
          {size.status === "not-built" ? "not built" : "size n/a"}
        </span>
        {size.budget_note && <span>{size.budget_note}</span>}
      </span>
    );
  }
  return (
    <span className={styles.manifestDetail}>
      <span className={styles.sizeStatus} data-size-status={size.status}>
        {size.status === "over"
          ? "over budget"
          : size.status === "warn"
            ? "near budget"
            : size.status === "no-budget"
              ? "no budget"
              : "in budget"}
      </span>
      <span>FLASH {regionLabel(size.flash)}</span>
      <span>RAM {regionLabel(size.ram)}</span>
      {size.budget_note && <span>{size.budget_note}</span>}
    </span>
  );
}

/**
 * How long ago the manifest was written, in words (#470).
 *
 * Relative, not an absolute stamp: "3 days ago" answers "can I trust this?"
 * at a glance, where a timestamp makes the reader do the subtraction. Rounded
 * DOWN at every step, so it can never overstate how fresh the file is.
 */
function writtenAgo(iso: string): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const seconds = Math.floor((Date.now() - at) / 1000);
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

function SystemManifestSection({
  manifest,
  postBuild,
  provenance,
  error,
  flashSlice,
  memory,
  sizes,
  sizesError,
}: {
  manifest: SystemManifest | null;
  postBuild: boolean;
  provenance: ManifestProvenance | null;
  error: string | null;
  flashSlice: (coreId: string) => void;
  memory: MemoryView | null;
  sizes: SizeReport | null;
  sizesError: string | null;
}) {
  const sizeByCore = new Map<string, SliceSize>(
    (sizes?.slices ?? []).map((s) => [s.core_id, s]),
  );
  // Two readings of one file (#484): the slice list is per-core wiring, the
  // memory map is the address space. Tabs rather than a second panel — both
  // come off the same `build/system-manifest.yaml` read, and a second panel
  // would duplicate that read and its "run `tan build` first" empty state.
  const [tab, setTab] = useState<"slices" | "memory">("slices");
  // Two independent commands feed this section, so both notes are rendered.
  // `sizesError` was reaching the view and being dropped on the floor: a
  // `tan size` failure left the footprint column simply absent, which reads as
  // "this build has no sizes" rather than "the measurement failed".
  const notes = [error, sizesError].filter((n): n is string => !!n);
  const age = provenance?.writtenAt ? writtenAgo(provenance.writtenAt) : null;
  if (!manifest) {
    return notes.length > 0 ? (
      <section className={styles.section}>
        <p className={styles.sectionTitle}>System manifest</p>
        {/* Keyed by position, not by the note text: the two notes fall back to
         *  the same `outcome.message` when tan itself is what failed, and React
         *  calls a repeated key unsupported ("may cause children to be
         *  duplicated and/or omitted"). The index is identity enough here: at
         *  most two notes, always manifest-then-size, static text with no state
         *  to carry across a re-render. */}
        {notes.map((note, i) => (
          <p key={i} className={styles.manifestNote}>
            {note}
          </p>
        ))}
      </section>
    ) : null;
  }
  return (
    <section className={styles.section}>
      <p className={styles.sectionTitle}>
        System manifest{" "}
        {/* The badge now carries the VERDICT, not just "a file exists".
            `post-build` used to be asserted from `fs.existsSync` alone, so an
            old build's slices and memory numbers rendered as current — #470. */}
        <span
          className={styles.manifestBadge}
          data-freshness={provenance?.freshness ?? "none"}
        >
          {!postBuild
            ? "projection"
            : provenance?.freshness === "stale"
              ? "stale"
              : "post-build"}
        </span>
        {/* The AGE is shown whatever the verdict, including `unknown`. It is
            the fact this side can always support, and it lets the reader draw
            the conclusion the host refuses to draw for them. */}
        {age && <span className={styles.manifestAge}>{age}</span>}
      </p>
      {/* Never only a badge: a warning nobody can act on is a puzzle. The host
          words this — it is the side that knows the build finished after the
          file was written, and with what exit code. */}
      {provenance?.reason && (
        <p
          className={styles.manifestStaleNote}
          role={provenance.freshness === "stale" ? "alert" : undefined}
        >
          {provenance.reason}
        </p>
      )}
      {sizesError && <p className={styles.manifestNote}>{sizesError}</p>}
      <div className={styles.tabs} role="tablist" aria-label="System manifest">
        <button
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={tab === "slices"}
          onClick={() => setTab("slices")}
        >
          Slices
        </button>
        <button
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={tab === "memory"}
          onClick={() => setTab("memory")}
        >
          Memory
        </button>
      </div>
      {tab === "memory" ? (
        <MemoryRegions memory={memory} sizes={sizes?.slices ?? []} />
      ) : (
        <ul className={styles.manifestSlices}>
          {manifest.slices.map((s) => {
            const active = s.os !== "off";
            return (
              <li key={s.core_id} className={styles.manifestSlice}>
                <span className={styles.coreId}>{s.core_id}</span>
                <span className={styles.backend} data-backend={s.os}>
                  {s.os}
                </span>
                <span className={styles.manifestStatus} data-status={s.status}>
                  {s.status}
                </span>
                {s.flash_method && (
                  <span className={styles.manifestFlash}>{s.flash_method}</span>
                )}
                <code className={styles.manifestTarget}>
                  {s.build_dir ??
                    s.board ??
                    s.machine ??
                    s.image ??
                    s.app ??
                    "—"}
                </code>
                <span className={styles.manifestActions}>
                  {active && isReady(s.flash_method) && (
                    <button
                      type="button"
                      className={styles.sliceBtn}
                      onClick={() => flashSlice(s.core_id)}
                    >
                      Flash
                    </button>
                  )}
                </span>
                {/* The status chip alone says `skipped` without saying why, which
                 *  is the complaint behind #331 — the manifest already carries
                 *  the answer and it was being dropped. `reason` first, because
                 *  it is the only one that explains a non-ok slice; then what
                 *  the build produced, then where to read the log. Wraps to its
                 *  own line via flex-basis so the chip row keeps its shape. */}
                {(s.reason || s.output_artefact || s.log_path) && (
                  <span className={styles.manifestDetail}>
                    {s.reason && (
                      <span className={styles.manifestReason}>{s.reason}</span>
                    )}
                    {s.output_artefact && (
                      <span>
                        out{" "}
                        <code className={styles.manifestDetailPath}>
                          {s.output_artefact}
                        </code>
                      </span>
                    )}
                    {s.log_path && (
                      <span>
                        log{" "}
                        <code className={styles.manifestDetailPath}>
                          {s.log_path}
                        </code>
                      </span>
                    )}
                  </span>
                )}
                {/* This is THIS BUILD's resolved toolchain, read straight from the
                 *  emitted manifest (`slices[].toolchain`). It is NOT a second
                 *  opinion on Hardware Explorer's "Toolchain" column — both read
                 *  the exact same `topology.<core>.toolchain` field
                 *  (`sdkCatalogue/parse.ts:137` here; alp-sdk
                 *  `alp_orchestrate/loader.py` sets `toolchain=entry.get("toolchain")`
                 *  from that same SoM-topology-merged-with-board.yaml-cores entry,
                 *  and `alp_orchestrate/buildplan.py` says outright it is "never
                 *  invented"). What differs is WHEN it was read, and it only
                 *  differs at all once a build has run: under the `projection`
                 *  badge tan re-derived this live from the current
                 *  board.yaml/preset (`build --manifest`), so it cannot be stale
                 *  and will agree with Hardware Explorer; under `post-build` it
                 *  came off a `build/system-manifest.yaml` on disk
                 *  (`build --manifest-from`), which a previous `som.sku` can have
                 *  left behind. While alp-sdk#964 blocks a per-core override,
                 *  that stale file is the only way the two can disagree; the
                 *  override — the thing that would let them genuinely diverge —
                 *  is the #314 picker half. Gated on `active` like the Flash
                 *  button: an `os: "off"` slice never builds, so its manifest
                 *  toolchain value (if any) would mislead. Absence renders as an
                 *  explicit "not reported", never a blank cell or a guessed
                 *  fallback — a preset that declares no toolchain is schema-legal
                 *  (som-preset-v1's `topology_entry` has `required: []`), though
                 *  no shipped preset omits it today. */}
                {active && (
                  <span className={styles.manifestDetail}>
                    <span>
                      build toolchain{" "}
                      {s.toolchain ? (
                        <code className={styles.manifestDetailPath}>
                          {s.toolchain}
                        </code>
                      ) : (
                        <em>not reported</em>
                      )}
                    </span>
                  </span>
                )}
                <SliceFootprint size={sizeByCore.get(s.core_id)} />
              </li>
            );
          })}
        </ul>
      )}
      {tab === "slices" && manifest.ipc.length > 0 && (
        <div className={styles.manifestSub}>
          <span className={styles.manifestSubTitle}>IPC</span>
          {manifest.ipc.map((link) => (
            <span key={link.name} className={styles.manifestChip}>
              {link.name} <em>{link.kind}</em> [{link.endpoints.join(" ↔ ")}]
              {link.status && link.status !== "ok" ? ` · ${link.status}` : ""}
              {/* Same gap as the slices above: a degraded link showed its
               *  status but never its reason, which the model already has. */}
              {link.reason ? ` · ${link.reason}` : ""}
            </span>
          ))}
        </div>
      )}
      {tab === "slices" && manifest.helper_mcus.length > 0 && (
        <div className={styles.manifestSub}>
          <span className={styles.manifestSubTitle}>Helper MCUs</span>
          {manifest.helper_mcus.map((mcu) => (
            <span key={mcu.name} className={styles.manifestChip}>
              {mcu.name} <em>{mcu.chip}</em>
              {!(isReady(mcu.flash_method) && isReady(mcu.firmware_path))
                ? " · firmware TBD"
                : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** A generated file: a toggle showing its path; expands to its contents. */
function FileRow({
  file,
  open,
  onToggle,
}: {
  file: BuildPlanGeneratedFile;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={styles.fileRow}>
      <button
        type="button"
        className={styles.fileToggle}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span
          className={styles.chevron}
          data-open={open || undefined}
          aria-hidden="true"
        >
          <Icon name="chevronRight" size={12} />
        </span>
        <code className={styles.filePath}>{file.path}</code>
      </button>
      {open && <pre className={styles.fileContent}>{file.contents}</pre>}
    </li>
  );
}

export function BuildPlanView() {
  const {
    plan,
    error,
    loading,
    manifest,
    manifestPostBuild,
    manifestProvenance,
    manifestError,
    memory,
    sizes,
    sizesError,
    reload,
    materialise,
    build,
    flashSlice,
  } = useBuildPlan();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (path: string) =>
    setExpanded((cur) => (cur === path ? null : path));

  // A slice with no command isn't buildable yet (paired with a warning); the
  // whole-plan build would fail, so gate Build until every slice has a command.
  const unbuildable = plan ? plan.slices.filter((s) => !s.command) : [];
  const canBuild = unbuildable.length === 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <p className={styles.title}>Build Plan</p>
          <Button appearance="secondary" onClick={reload} disabled={loading}>
            Refresh
          </Button>
        </div>
        <p className={styles.subtitle}>
          The per-core build plan — what each slice builds, before anything
          runs.
        </p>
      </header>

      {loading ? (
        <div className={styles.skeletons}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error || !plan ? (
        <EmptyState
          icon={<Icon name="cpu" size={28} />}
          title="No build plan"
          description={
            error ??
            "Open a project with a board.yaml (and a connected SDK) to preview its build plan."
          }
        />
      ) : (
        <div className={styles.body}>
          <div className={styles.meta}>
            <span className={styles.sku}>{plan.sku}</span>
            <span className={styles.metaItem}>
              {plan.slices.length} slice{plan.slices.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className={styles.boardYaml} title={plan.boardYaml}>
            <code>{plan.boardYaml}</code>
          </div>

          <div className={styles.actions}>
            <Button appearance="secondary" onClick={materialise}>
              Materialise
            </Button>
            <Button
              appearance="primary"
              onClick={build}
              disabled={!canBuild}
              title={
                canBuild
                  ? undefined
                  : `${unbuildable.length} slice(s) have no command yet — resolve the warnings before building.`
              }
            >
              Build
            </Button>
          </div>
          {!canBuild && (
            <p className={styles.buildNote}>
              <Icon name="warning" size={12} />
              <span>
                Build unavailable —{" "}
                <strong>{unbuildable.map((s) => s.coreId).join(", ")}</strong>{" "}
                {unbuildable.length === 1 ? "has" : "have"} no command yet.
                Materialise still writes the config artefacts.
              </span>
            </p>
          )}

          <ul className={styles.slices}>
            {plan.slices.map((slice) => (
              <li key={slice.coreId}>
                <Card padding="md" className={styles.slice}>
                  <div className={styles.sliceHead}>
                    <span className={styles.coreId}>{slice.coreId}</span>
                    <span
                      className={styles.backend}
                      data-backend={slice.backend}
                    >
                      {slice.backend}
                    </span>
                  </div>
                  <code className={styles.cmd}>{commandLine(slice)}</code>
                  <div className={styles.sliceMeta}>
                    <span className={styles.buildDir}>{slice.buildDir}</span>
                  </div>
                  {Object.keys(slice.env).length > 0 && (
                    <dl className={styles.env}>
                      {Object.entries(slice.env).map(([key, value]) => (
                        <div key={key} className={styles.envRow}>
                          <dt className={styles.envKey}>{key}</dt>
                          <dd className={styles.envVal}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {slice.configArtefacts.length > 0 && (
                    <ul className={styles.fileList}>
                      {slice.configArtefacts.map((file) => (
                        <FileRow
                          key={file.path}
                          file={file}
                          open={expanded === file.path}
                          onToggle={() => toggle(file.path)}
                        />
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          {plan.sharedArtefacts.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>
                Shared artefacts ({plan.sharedArtefacts.length})
              </p>
              <ul className={styles.fileList}>
                {plan.sharedArtefacts.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    open={expanded === file.path}
                    onToggle={() => toggle(file.path)}
                  />
                ))}
              </ul>
            </section>
          )}

          {plan.warnings.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>
                Warnings ({plan.warnings.length})
              </p>
              <ul className={styles.warnings}>
                {plan.warnings.map((warn, i) => (
                  <li key={`${warn.code}-${i}`} className={styles.warning}>
                    <span className={styles.warnCode}>{warn.code}</span>
                    {warn.coreId && (
                      <span className={styles.warnCore}>{warn.coreId}</span>
                    )}
                    <span className={styles.warnMsg}>{warn.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SystemManifestSection
            manifest={manifest}
            postBuild={manifestPostBuild}
            provenance={manifestProvenance}
            error={manifestError}
            flashSlice={flashSlice}
            memory={memory}
            sizes={sizes}
            sizesError={sizesError}
          />
        </div>
      )}
    </div>
  );
}
