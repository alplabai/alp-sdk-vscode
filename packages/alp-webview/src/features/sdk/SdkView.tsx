import { useEffect, useState } from "react";
import {
  Button,
  Icon,
  Markdown,
  Skeleton,
  Spinner,
  StatusChip,
} from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type {
  ChipState,
  LocalSdkEntry,
  SdkRelease,
  SdkStatus,
} from "../../types";
import { postMessage } from "../../vscode";
import styles from "./SdkView.module.css";
import { useSdk } from "./useSdk";

type SdkTab = "active" | "local" | "download";

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

function localEntryChip(r: LocalSdkEntry["readiness"]): ChipState {
  return r === "ready"
    ? "ready"
    : r === "partial"
      ? "setup-required"
      : "not-installed";
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

/** Last path segment (cross-platform) — the install dir is named after the tag. */
function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** The local installation matching a release tag, if any (side-by-side cache). */
function installedFor(
  release: SdkRelease,
  entries: LocalSdkEntry[],
): LocalSdkEntry | undefined {
  return entries.find(
    (e) =>
      pathTail(e.path) === release.tag ||
      (e.version !== null && e.version === release.tag.replace(/^v/, "")),
  );
}

/** A single release row: version + date, install/installed/active state, and an
 *  expandable changelog. Models the VS Code Extensions-view card pattern. */
function ReleaseCard({
  release,
  installed,
  isActive,
  expanded,
  onToggle,
  onInstall,
  onUse,
}: {
  release: SdkRelease;
  installed: LocalSdkEntry | undefined;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
  onInstall: () => void;
  onUse: () => void;
}) {
  return (
    <div className={styles.releaseCard} data-active={isActive || undefined}>
      <div className={styles.releaseCardHead}>
        <div className={styles.releaseTagBlock}>
          <span className={styles.releaseTagName}>{release.tag}</span>
          {release.publishedAt && (
            <span className={styles.releaseDate}>
              {formatDate(release.publishedAt)}
            </span>
          )}
        </div>
        <div className={styles.releaseActions}>
          {isActive ? (
            <span className={styles.activeBadge}>
              <Icon name="check" size={12} /> Active
            </span>
          ) : installed ? (
            <>
              <span className={styles.installedBadge}>Installed</span>
              <Button appearance="secondary" onClick={onUse}>
                Use
              </Button>
            </>
          ) : (
            <Button appearance="primary" onClick={onInstall}>
              Install
            </Button>
          )}
        </div>
      </div>

      {(release.releaseNotes || release.releaseNotesSummary) && (
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
              <Markdown>
                {release.releaseNotes || release.releaseNotesSummary}
              </Markdown>
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
  } = useSdk();
  const [tab, setTab] = useState<SdkTab>("active");
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  // Auto-load the release list once so the Download tab isn't a manual step.
  useEffect(() => {
    if (releases === null) loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const localCount = sdk?.localEntries.length ?? 0;

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
            <Button
              appearance="primary"
              onClick={() =>
                postMessage({
                  type: "runCommand",
                  command: "alp.openSdkManager",
                })
              }
            >
              Manage SDK →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>SDK Manager</p>

      {/* Tab bar */}
      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === "active"}
          className={styles.tab}
          onClick={() => setTab("active")}
        >
          Active
        </button>
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={styles.tab}
          onClick={() => setTab("local")}
        >
          Local
          {localCount > 0 && (
            <span className={styles.tabBadge}>{localCount}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === "download"}
          className={styles.tab}
          onClick={() => setTab("download")}
        >
          Download
        </button>
      </div>

      {/* Active tab */}
      {tab === "active" && (
        <div className={styles.tabContent}>
          <div className={layout.setupRow}>
            <div className={layout.setupRowHeader}>
              <span className={layout.setupRowLabel}>
                {sdk.version ? `v${sdk.version}` : "Active SDK"}
              </span>
              <StatusChip
                state={
                  sdk.activePath ? sdkChip(sdk.readiness) : "not-installed"
                }
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
              <p className={layout.setupRowDesc}>
                No active SDK configured. Install one from Download, or Browse
                to an SDK on disk.
              </p>
            )}
            <div className={layout.setupRowAction}>
              <Button
                appearance="secondary"
                title="Browse for an SDK directory"
                onClick={() => browseSdk()}
              >
                Browse…
              </Button>
              {sdk.activePath && (
                <Button
                  appearance="secondary"
                  title="Clear the active SDK (keeps it installed)"
                  onClick={() => deactivate()}
                >
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Local tab */}
      {tab === "local" && (
        <div className={styles.tabContent}>
          {localCount === 0 ? (
            <p className={`${layout.setupRowDesc} ${styles.emptyState}`}>
              No local SDK installations found. Use Download to get an SDK.
            </p>
          ) : (
            <div className={styles.entryList}>
              {sdk.localEntries.map((entry) => (
                <div key={entry.path} className={styles.entry}>
                  <div className={styles.entryHeader}>
                    <span className={styles.entryVersion}>
                      {entry.version ?? pathTail(entry.path)}
                    </span>
                    <StatusChip state={localEntryChip(entry.readiness)} />
                  </div>
                  <p
                    className={`${layout.setupRowDesc} ${layout.pathMono}`}
                    title={entry.path}
                  >
                    {shortPath(entry.path)}
                  </p>
                  <div className={layout.setupRowAction}>
                    {entry.path !== sdk.activePath ? (
                      <Button
                        appearance="secondary"
                        onClick={() => switchSdk(entry.path)}
                      >
                        Use This
                      </Button>
                    ) : (
                      <Button
                        appearance="secondary"
                        title="Clear the active SDK (keeps it installed)"
                        onClick={() => deactivate()}
                      >
                        Deactivate
                      </Button>
                    )}
                    <Button
                      appearance="danger"
                      title={
                        entry.removable
                          ? "Delete this Alp-installed SDK from disk"
                          : "Delete this folder from disk (added via Browse / a checkout)"
                      }
                      onClick={() => uninstall(entry.path)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Download tab — release card list */}
      {tab === "download" && (
        <div className={styles.tabContent}>
          <p className={layout.setupRowDesc}>
            Versioned Alp SDK releases install side by side under{" "}
            <span className={layout.pathMono}>~/.alp/sdk/</span>. Pick one per
            project from Local or the status bar.
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
            <div className={layout.loadingRow}>
              <Spinner />
              <span className={layout.setupRowDesc}>Loading releases…</span>
            </div>
          ) : releases.length === 0 ? (
            <p className={`${layout.setupRowDesc} ${styles.emptyState}`}>
              No releases found.
            </p>
          ) : (
            <div className={styles.releaseList}>
              {releases.map((release) => {
                const installed = installedFor(release, sdk.localEntries);
                return (
                  <ReleaseCard
                    key={release.tag}
                    release={release}
                    installed={installed}
                    isActive={!!installed && installed.path === sdk.activePath}
                    expanded={expandedTag === release.tag}
                    onToggle={() =>
                      setExpandedTag((t) =>
                        t === release.tag ? null : release.tag,
                      )
                    }
                    onInstall={() => install(release.tag)}
                    onUse={() => installed && switchSdk(installed.path)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
