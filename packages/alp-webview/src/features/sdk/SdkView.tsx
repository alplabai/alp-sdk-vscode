import { useEffect, useRef, useState } from "react";
import {
  Button,
  Icon,
  Markdown,
  Skeleton,
  Spinner,
  StatusChip,
} from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { ChipState, SdkStatus } from "../../types";
import styles from "./SdkView.module.css";
import { useSdk } from "./useSdk";
import type { SdkRow } from "../../shared/sdkRows";
import { buildRows } from "../../shared/sdkRows";

function sdkChip(readiness: SdkStatus["readiness"]): ChipState {
  switch (readiness) {
    case "ready":
      return "ready";
    case "partial":
      return "setup-required";
    default:
      return "not-installed";
  }
}

function shortPath(p: string): string {
  const parts = p.split("/");
  if (parts.length > 5) return "~/…/" + parts.slice(-2).join("/");
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

interface SdkRowCardProps {
  row: SdkRow;
  expanded: boolean;
  onToggle: () => void;
  onInstall: () => void;
  onUse: () => void;
  onDeactivate: () => void;
  onRemove: () => void;
}

/** A single SDK row: version + date + state badges, state-aware actions, and an
 *  expandable changelog. Models the VS Code Extensions-view item. */
/** How many placeholder rows the loading list draws. Matched to
 *  `VISIBLE_RELEASES` below, which is what the arrived list actually shows
 *  before the "Show N older releases" toggle: three placeholders against a
 *  two-row list shrank the section on arrival, which is the jump these exist
 *  to remove, just in the other direction. */
const SKELETON_ROW_COUNT = 2;

/** A release row's shape, without the release. Reuses `.releaseCard` and its
 *  head so the real rows land on the same geometry: the previous loading state
 *  was a single spinner line, and the section jumped every time the list
 *  arrived. */
function SdkRowSkeleton() {
  return (
    <div className={styles.releaseCard} aria-hidden="true">
      <div className={styles.releaseCardHead}>
        <div className={styles.releaseTagBlock}>
          <Skeleton width={96} height={14} />
          <Skeleton width={64} height={12} />
        </div>
        <Skeleton width={72} height={22} />
      </div>
    </div>
  );
}

function SdkRowCard({
  row,
  expanded,
  onToggle,
  onInstall,
  onUse,
  onDeactivate,
  onRemove,
}: SdkRowCardProps) {
  return (
    <div className={styles.releaseCard} data-active={row.isActive || undefined}>
      <div className={styles.releaseCardHead}>
        <div className={styles.releaseTagBlock}>
          <span className={styles.releaseTagName}>{row.label}</span>
          {row.date && (
            <span className={styles.releaseDate}>{formatDate(row.date)}</span>
          )}
          {row.source === "linked" && (
            <span
              className={styles.sourceBadge}
              data-linked
              title="Linked checkout (sibling/submodule), not Alp-managed"
            >
              Linked
            </span>
          )}
        </div>
        <div className={styles.releaseActions}>
          {row.isActive &&
            (row.activeSource === "pinned" ? (
              <span
                className={styles.activeBadge}
                title="Pinned as the active SDK for this workspace"
              >
                <Icon name="check" size={12} /> Active
              </span>
            ) : (
              // Nothing is pinned; this is what resolution fell back to. Saying
              // "Active" here is what made Deactivate look broken — it cleared
              // a pin that never existed, so the badge never moved.
              <span
                className={styles.activeBadge}
                data-auto
                title="No SDK is pinned — this is what Alp falls back to (the newest install / the SDK next to this project). Press Use to pin it."
              >
                Default (auto-detected)
              </span>
            ))}
          {row.source === "available" ? (
            <Button appearance="primary" onClick={onInstall}>
              Install
            </Button>
          ) : (
            <>
              {/* Deactivate only where a pin exists to clear. On an
                  auto-detected row it is a no-op button, so the row keeps
                  offering "Use" — which writes the pin and makes the state
                  explicit. */}
              {row.activeSource === "pinned" ? (
                <Button
                  appearance="secondary"
                  title="Clear the active SDK (keeps it installed)"
                  onClick={onDeactivate}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  appearance="secondary"
                  title={
                    row.isActive
                      ? "Pin this SDK for the workspace (it is only the fallback right now)"
                      : "Make this the active SDK for the workspace"
                  }
                  onClick={onUse}
                >
                  Use
                </Button>
              )}
              <Button
                appearance="danger"
                title={
                  row.source === "linked"
                    ? "Delete this folder from disk (added via Browse / a checkout)"
                    : "Delete this Alp-installed SDK from disk"
                }
                onClick={onRemove}
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {row.changelog && (
        <>
          <button
            type="button"
            className={styles.changelogToggle}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <span
              className={styles.chevron}
              data-open={expanded || undefined}
              aria-hidden="true"
            >
              <Icon name="chevronRight" size={12} />
            </span>
            Changelog
          </button>
          {expanded && (
            <div className={styles.changelogBody}>
              <Markdown>{row.changelog}</Markdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SdkView({ compact = false }: { compact?: boolean }) {
  const {
    sdk,
    releases,
    installLog,
    installActive,
    loadReleases,
    install,
    switchSdk,
    uninstall,
    deactivate,
    browseSdk,
    bootstrap,
    setup,
  } = useSdk();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllReleases, setShowAllReleases] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-load the release list once so the list isn't a manual step.
  useEffect(() => {
    if (releases === null) loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new release list (success or empty) ends the refresh spinner.
  useEffect(() => {
    setRefreshing(false);
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, [releases]);

  // Clean up the safety timer on unmount.
  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    loadReleases();
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // Safety: clear the spinner even if the fetch fails silently (no message).
    refreshTimer.current = setTimeout(() => setRefreshing(false), 12000);
  }

  if (!sdk) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>SDK Manager</p>
        <div className={layout.loadingRow}>
          <Skeleton lines={2} />
        </div>
      </div>
    );
  }

  // Compact (sidebar) summary: active SDK + a jump to the full manager.
  if (compact) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>SDK Manager</p>
        <div className={layout.setupRow}>
          <div className={layout.setupRowHeader}>
            <span className={layout.setupRowLabel}>
              {sdk.version ? `v${sdk.version}` : "Active SDK"}
            </span>
            <StatusChip
              state={sdk.activePath ? sdkChip(sdk.readiness) : "not-installed"}
            />
          </div>
          {sdk.activePath ? (
            <p
              className={`${layout.setupRowDesc} ${layout.pathMono}`}
              title={sdk.activePath}
            >
              {shortPath(sdk.activePath)}
            </p>
          ) : (
            <p className={layout.setupRowDesc}>No active SDK configured.</p>
          )}
          <div className={layout.setupRowAction}>
            <Button appearance="secondary" onClick={() => browseSdk()}>
              Browse…
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const rows = buildRows(releases, sdk.localEntries);
  // Keep the list short: show the two newest releases (plus the active one, so
  // it's never hidden), collapse the rest behind a toggle.
  const VISIBLE_RELEASES = 2;
  const visibleRows = showAllReleases
    ? rows
    : rows.filter((row, index) => index < VISIBLE_RELEASES || row.isActive);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className={layout.section}>
      <div className={styles.header}>
        <p className={layout.sectionTitle}>SDK Manager</p>
        <div className={styles.headerActions}>
          <Button
            appearance="secondary"
            title="Reload the release list"
            loading={refreshing}
            disabled={releases === null}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Button
            appearance="secondary"
            title="Use an SDK already on disk"
            onClick={() => browseSdk()}
          >
            Browse…
          </Button>
          {/* An installed SDK is not a buildable one: `tan build` plans the
              slices fine and then skips every one of them — "skipped: m55_hp
              [zephyr] -- tool `west` not found" — because west lives in the
              workspace venv `tan bootstrap` creates. Bootstrap belongs beside
              Install for that reason, not in the palette only.

              It DISAPPEARS once the environment exists. `westAvailable` is the
              honest signal for that and `lastBootstrapAt` is not: the stamp
              records that bootstrap was TRIGGERED, so a run that failed
              half-way would hide the one button that repairs it. While the run
              is in flight `bootstrapRunning` keeps the button visible and
              spinning — west appears on PATH partway through, and hiding it at
              that moment would read as "done" mid-fetch.

              Gated on `activePath`: bootstrap builds the environment of the
              SDK that is ACTIVE, so with none selected there is nothing for it
              to act on, and the title says which of the two steps is missing. */}
          {(!setup?.westAvailable || setup?.bootstrapRunning) && (
            <Button
              appearance="secondary"
              loading={setup?.bootstrapRunning ?? false}
              title={
                setup?.bootstrapRunning
                  ? "Bootstrap is running in the terminal…"
                  : sdk.activePath
                    ? "Set up this SDK's build environment (workspace venv, west, Zephyr modules, Python deps) — about 3 GB on disk"
                    : "Install and activate an SDK first — bootstrap sets up the ACTIVE SDK's environment"
              }
              disabled={!sdk.activePath || (setup?.bootstrapRunning ?? false)}
              onClick={() => bootstrap()}
            >
              Bootstrap…
            </Button>
          )}
        </div>
      </div>

      <p className={styles.intro}>
        Versioned Alp SDK releases install side by side under{" "}
        <span className={layout.pathMono}>~/.alp/sdk/</span>. Install one, then
        activate it per project here or from the status bar.
      </p>

      {installActive && (
        <div className={styles.installStatus}>
          <Spinner />
          <span className={layout.setupRowDesc}>
            {installLog ?? "Installing…"}
          </span>
        </div>
      )}

      {releases === null ? (
        <div
          className={styles.releaseList}
          role="status"
          aria-label="Loading the SDK list"
        >
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
            <SdkRowSkeleton key={index} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className={`${layout.setupRowDesc} ${styles.emptyState}`}>
          No SDKs found. Install a release above, or Browse to an SDK on disk.
        </p>
      ) : (
        <div className={styles.releaseList}>
          {visibleRows.map((row) => (
            <SdkRowCard
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() =>
                setExpandedId((id) => (id === row.id ? null : row.id))
              }
              onInstall={() => row.installTag && install(row.installTag)}
              onUse={() => row.localPath && switchSdk(row.localPath)}
              onDeactivate={() => deactivate()}
              onRemove={() => row.localPath && uninstall(row.localPath)}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              className={styles.showMore}
              onClick={() => setShowAllReleases(true)}
            >
              Show {hiddenCount} older release{hiddenCount > 1 ? "s" : ""}
            </button>
          )}
          {showAllReleases && rows.length > VISIBLE_RELEASES && (
            <button
              type="button"
              className={styles.showMore}
              onClick={() => setShowAllReleases(false)}
            >
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
