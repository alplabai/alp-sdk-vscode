import { useState } from "react";
import { Button, Skeleton, Spinner, StatusChip } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { ChipState, LocalSdkEntry, SdkStatus } from "../../types";
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

export function SdkView({ compact = false }: { compact?: boolean }) {
  const {
    sdk,
    releases,
    installLog,
    installActive,
    loadReleases,
    install,
    switchSdk,
    browseSdk,
  } = useSdk();
  const [tab, setTab] = useState<SdkTab>("active");
  const [selectedTag, setSelectedTag] = useState("");

  const localCount = sdk?.localEntries.length ?? 0;
  const latestTag = releases?.[0]?.tag ?? "";
  const installTarget = selectedTag || latestTag;

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
              <p className={layout.setupRowDesc}>No active SDK configured.</p>
            )}
            <div className={layout.setupRowAction}>
              <Button
                appearance="secondary"
                title="Browse for an SDK directory"
                onClick={() => browseSdk()}
              >
                Browse…
              </Button>
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
                      {entry.version ?? "unknown"}
                    </span>
                    <StatusChip state={localEntryChip(entry.readiness)} />
                  </div>
                  <p
                    className={`${layout.setupRowDesc} ${layout.pathMono}`}
                    title={entry.path}
                  >
                    {shortPath(entry.path)}
                  </p>
                  {entry.path !== sdk.activePath && (
                    <div className={layout.setupRowAction}>
                      <Button
                        appearance="secondary"
                        onClick={() => switchSdk(entry.path)}
                      >
                        Use This
                      </Button>
                    </div>
                  )}
                  {entry.path === sdk.activePath && (
                    <p className={styles.activeLabel}>← active</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Download tab */}
      {tab === "download" && (
        <div className={styles.tabContent}>
          <p className={layout.setupRowDesc}>
            Download a versioned ALP SDK release to{" "}
            <span className={layout.pathMono}>~/.alp/sdk/</span>.
          </p>

          {/* Install progress */}
          {installActive && (
            <div className={styles.installStatus}>
              <Spinner />
              <span className={layout.setupRowDesc}>
                {installLog ?? "Installing…"}
              </span>
            </div>
          )}
          {!installActive && installLog && (
            <p
              className={`${layout.setupRowDesc} ${styles.installResult}`}
              data-success={
                !installLog.startsWith("Install failed") ? "" : undefined
              }
            >
              {installLog}
            </p>
          )}

          {!installActive && (
            <div className={styles.downloadControls}>
              {releases === null ? (
                <Button onClick={() => loadReleases()}>Load Releases</Button>
              ) : releases.length === 0 ? (
                <p className={layout.setupRowDesc}>No releases found.</p>
              ) : (
                <>
                  <div className={styles.releasePicker}>
                    <select
                      className={styles.releaseSelect}
                      value={installTarget}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      aria-label="Select SDK release version"
                    >
                      {releases.map((r) => (
                        <option key={r.tag} value={r.tag}>
                          {r.tag}
                          {r.publishedAt
                            ? `  ·  ${formatDate(r.publishedAt)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      appearance="primary"
                      onClick={() => install(installTarget)}
                    >
                      Install
                    </Button>
                  </div>
                  {releases.find((r) => r.tag === installTarget)
                    ?.releaseNotesSummary && (
                    <p
                      className={`${layout.setupRowDesc} ${styles.releaseNotes}`}
                    >
                      {
                        releases.find((r) => r.tag === installTarget)!
                          .releaseNotesSummary
                      }
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
