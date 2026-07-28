// SPDX-License-Identifier: Apache-2.0
//
// Host wiring for the dependency table. ONE `tan doctor --build` run per
// report: the envelope goes to the pure planner (`@alp-sdk/core/deps/planner`),
// and this file adds only the facts tan structurally cannot report — the `tan`
// binary this extension resolved, the versions the extension already probed for
// its own state, and the newest published SDK tag.
//
// Nothing here re-derives a fact tan owns. Where tan is silent the cell is
// `null` (the table renders a dash) and the fix is an issue against tan-cli,
// not a TypeScript computation — that is how tan-cli#104/#105 happened.

import {
  DependencyAction,
  DependencyLatest,
  DependencyReport,
  DependencyStatus,
  DoctorEnvelopeData,
  planDependencyReport,
  TAN_ROW_NAME,
} from "@alp-sdk/core/deps/planner";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import * as vscode from "vscode";

import { cliSkew, SUPPORTED_CLI_VERSION } from "../alpCli/service";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import type { AlpIdeState } from "../ideHub/messages";
import { collectProjectContext } from "../project/vscodeAdapter";
import { runToolchainFix } from "../toolchain";
import { log } from "../util";

// ── The latest-SDK lookup (cached; must never block the panel) ───────────────

/**
 * globalState key holding the last answer to "what is the newest published SDK
 * release?", with the wall-clock stamp of the fetch.
 *
 * globalState, not workspaceState: the answer is about github.com, not about
 * this folder, and every window on the machine draws on the same rate-limit
 * budget. Namespaced under `alp.deps.` so it is greppable next to the other
 * `alp.*` keys in src/alpCli/vscodeAdapter.ts.
 */
const LATEST_SDK_CACHE_KEY = "alp.deps.latestSdkTag";

/**
 * 12 hours.
 *
 * `tan sdk list` is a LIVE unauthenticated GitHub call (measured ~0.57 s and
 * ~72 KB) against a 60-requests-per-hour-per-IP budget already shared with the
 * Hub's SDK Manager. So the panel must never make it a per-open cost.
 *
 * The pinned tan v0.4.0 DOES bound the request (`http.rs` builds one shared
 * agent with a total timeout, covered by its own
 * `the_timeout_bounds_a_request_the_peer_never_answers` test), so an
 * unreachable host no longer stalls until tan's spawn cap. v0.3.1 and earlier
 * set none — still reachable through `alpSdk.cliPath` — and the rate budget
 * argument above holds either way, so the cache stays.
 *
 * 12 h and not shorter: SDK releases land weeks apart, so a tighter TTL buys
 * nothing but requests. 12 h and not longer: a customer who opens the IDE the
 * morning after a release still sees it that day, and a laptop that was offline
 * at the last attempt gets a second chance the same working day.
 */
const LATEST_SDK_TTL_MS = 12 * 60 * 60 * 1000;

/** The cached lookup. `tag: null` is a real answer — "tan listed releases and
 *  none of them was a stable one" — and is cached like any other. */
interface LatestSdkCache {
  tag: string | null;
  fetchedAt: number;
}

/**
 * Whether the cached latest-SDK answer must be re-fetched.
 *
 * Exported for the test, and deliberately total: an absent entry, an entry from
 * a build that stored a different shape, and an entry stamped in the FUTURE
 * (the machine clock moved backwards after the write — a dual-boot or a
 * corrected NTP sync) all read as stale. Trusting a future stamp would pin the
 * cache until the clock caught up, which can be months.
 */
export function latestSdkCacheStale(
  cache: LatestSdkCache | undefined,
  now: number,
  ttlMs: number = LATEST_SDK_TTL_MS,
): boolean {
  if (!cache || typeof cache.fetchedAt !== "number") return true;
  if (cache.fetchedAt > now) return true;
  return now - cache.fetchedAt >= ttlMs;
}

/**
 * The newest SDK release tag that is NOT a pre-release.
 *
 * `tan sdk list` returns GitHub's own newest-first ordering (so "newest" is
 * tan's fact, not a sort invented here) but its envelope carries NO `draft` /
 * `prerelease` flag — so `releases[0]` would offer a release candidate as
 * "latest" the day one is published, and the panel would tell every customer to
 * update onto it. The tag is the only signal there is.
 *
 * DELETABLE HEURISTIC: the moment `tan sdk list` carries GitHub's own
 * `prerelease` flag this becomes `releases.find((r) => !r.prerelease)` and tan
 * owns the fact again. That flag is the tan-cli-side ask; this reads a tag
 * because today there is nothing else to read.
 */
export function pickLatestSdkTag(
  releases: readonly { tag: string }[],
): string | null {
  return releases.find((release) => isStableTag(release.tag))?.tag ?? null;
}

/** SemVer §9: the pre-release is everything after the first `-` and before the
 *  `+` build metadata. `v1.6.0-rc.1` is not a release; `v1.6.0+build.7` is. */
function isStableTag(tag: string): boolean {
  const core = tag.trim().replace(/^v/, "").split("+")[0] ?? "";
  return core.length > 0 && !core.includes("-");
}

/**
 * The newest stable SDK tag, from the cache unless it is stale or the user
 * explicitly asked for a refresh.
 *
 * A failed lookup is NEVER a toast. Offline is the ordinary case for an
 * embedded workstation, the customer did not ask for this call, and there is
 * nothing to click — so it degrades to whatever was cached (or `null`, which
 * the table renders as a dash) plus one line in the "Alp SDK" channel.
 */
async function latestSdkTag(
  context: vscode.ExtensionContext,
  force: boolean,
  signal?: AbortSignal,
): Promise<string | null> {
  const cache = context.globalState.get<LatestSdkCache>(LATEST_SDK_CACHE_KEY);
  if (!force && !latestSdkCacheStale(cache, Date.now())) {
    return cache?.tag ?? null;
  }
  const { outcome } = await runAlpCommand(context, ["sdk", "list"], undefined, {
    signal,
  });
  const envelope = outcome.envelope;
  if (!envelope || !envelope.ok) {
    log(`[deps] latest-SDK lookup unavailable: ${outcome.message}`);
    // The last known answer beats a dash, and it is stamped — a stale tag stays
    // stale, so the next open retries. Null only when nothing was ever cached.
    return cache?.tag ?? null;
  }
  const releases =
    (envelope.data as { releases?: SdkRelease[] }).releases ?? [];
  const tag = pickLatestSdkTag(releases);
  await context.globalState.update(LATEST_SDK_CACHE_KEY, {
    tag,
    fetchedAt: Date.now(),
  } satisfies LatestSdkCache);
  return tag;
}

// ── The doctor envelope ──────────────────────────────────────────────────────

/**
 * Boundary check on the untrusted `data` payload before the planner reads it.
 *
 * Deliberately does NOT look at `missingPrerequisites`: this narrows the value,
 * it never rebuilds it, so the key's ABSENCE survives into the planner — which
 * is what its feature detection turns on. The pinned tan v0.4.0 DOES emit the
 * key, so that detection now resolves to the real data on a default install;
 * the absent branch remains live for an older binary pointed at through
 * `alpSdk.cliPath`, which is why the key is still passed through untouched
 * rather than defaulted here.
 */
function isDoctorEnvelopeData(value: unknown): value is DoctorEnvelopeData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown> | undefined;
  if (!Array.isArray(data.checks) || !summary) return false;
  if (
    typeof summary.pass !== "number" ||
    typeof summary.warn !== "number" ||
    typeof summary.fail !== "number"
  ) {
    return false;
  }
  return data.checks.every((check) => {
    const entry = check as Record<string, unknown> | null;
    return (
      typeof entry?.name === "string" &&
      typeof entry.status === "string" &&
      typeof entry.detail === "string"
    );
  });
}

// ── Host-known cells ─────────────────────────────────────────────────────────

/** tan's check name for the SDK itself — the one row with a remote "latest". */
const SDK_ROW_NAME = "sdk";

/**
 * The versions this extension ALREADY probed for its own state
 * (`SetupStatus.toolVersions`, one batch per state refresh), keyed by tan's
 * check name.
 *
 * This is not a second probe: the pinned doctor envelope carries no per-check
 * version field at all, so without this every cell reads a dash.
 *
 * TAN-SIDE ASK (the durable fix): a per-check `version` on the doctor
 * envelope's `checks[]`. The moment tan emits it this whole function is
 * deleted and the extension stops holding an opinion about versions at all.
 *
 * Until then it is gated on tan's OWN verdict — `status` must be `pass`.
 * The two probes are not the same probe (this extension reads its PATH, tan
 * reads its own), and on a row tan reports as missing they disagree by
 * definition: the `ninja` row rendered Installed "1.11.1" next to "fail /
 * ninja not found". A version is shown only where tan already agreed there is
 * one to show; everywhere else the cell is a dash.
 *
 * There is deliberately NO `westResolved` arm. That check asks whether west
 * resolves inside the workspace venv — a workspace-resolution question, not a
 * tool-version one — while `toolVersions.west` is a PATH probe of a DIFFERENT
 * binary. Pasting one onto the other made an ordinary pre-bootstrap machine
 * render: "west (workspace) / 1.5.0 / warn / west not found — run `tan
 * bootstrap` to create the workspace venv", two cells of one row
 * contradicting each other. It renders a dash now, which is the truth.
 */
function installedVersionFor(
  name: string,
  status: DependencyStatus,
  state: AlpIdeState,
): string | null {
  if (status !== "pass") return null;
  switch (name) {
    case "west":
      return state.setup.toolVersions.west;
    case "cmake":
      return state.setup.toolVersions.cmake;
    case "ninja":
      return state.setup.toolVersions.ninja;
    case SDK_ROW_NAME:
      return state.sdk.version;
    default:
      return null;
  }
}

/** Release tags are `v0.6.0`; `cliSkew`'s regex is anchored on a bare
 *  `MAJOR.MINOR.PATCH`. Only the COMPARISON sees the stripped form — the tag
 *  itself is still displayed verbatim. */
function bareVersion(version: string | null): string | null {
  return version === null ? null : version.replace(/^v/, "");
}

// ── The report ───────────────────────────────────────────────────────────────

export interface DependencyReportResult {
  /** `null` when `tan doctor --build` produced no usable envelope. */
  report: DependencyReport | null;
  /** Customer-facing sentence for that empty state, shown INLINE by the panel.
   *  The raw stderr / exit code was already logged by `runAlpCommand`. */
  error?: string;
}

/**
 * Build the dependency report: one `tan doctor --build` run, fed to the pure
 * planner, plus the host-known cells.
 *
 * `state` is the shared `AlpIdeState` the panel already subscribes to — passed
 * in rather than re-probed, so this adds no readiness query of its own.
 */
export async function buildDependencyReport(
  context: vscode.ExtensionContext,
  state: AlpIdeState,
  options: { signal?: AbortSignal } = {},
): Promise<DependencyReportResult> {
  // cwd, always — and NO cwd means no run (#371). `tan doctor --build`
  // discovers the project from where it runs, and tan 0.4.0+ walks UP from
  // there looking for an enclosing SDK; with none passed the child inherits the
  // extension host's own directory (on Windows, the VS Code install directory)
  // and the report describes a directory the customer never chose. The deleted
  // Toolchain Doctor command refused here with a `noWorkspace` precondition;
  // this is the same refusal, rendered in the panel that replaced it.
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    return {
      report: null,
      error:
        "No project folder is open, so there is nothing to check. " +
        "Open your Alp SDK project folder and refresh.",
    };
  }
  const { outcome } = await runAlpCommand(
    context,
    ["doctor", "--build"],
    project.workspaceRoot,
    { signal: options.signal },
  );
  const data = outcome.envelope?.data;
  if (!outcome.envelope || !isDoctorEnvelopeData(data)) {
    log(
      `[deps] doctor --build produced no usable envelope: ${outcome.message}`,
    );
    return { report: null, error: outcome.message };
  }

  const planned = planDependencyReport({
    data,
    bootstrapRunning: state.setup.bootstrapRunning,
    cli: {
      installed: state.setup.toolVersions.tan,
      // A pin, not a release: this extension build requires exactly this tan.
      latest: { version: SUPPORTED_CLI_VERSION, kind: "pin" },
    },
    // The repo's ONE SemVer comparator. Core must not grow a second.
    compareVersions: cliSkew,
  });

  return {
    report: {
      ...planned,
      rows: planned.rows.map((row) =>
        // The planner owns the `tan` row end to end (installed version, the
        // pin, and the deliberate absence of an action).
        row.name === TAN_ROW_NAME
          ? row
          : {
              ...row,
              installed: installedVersionFor(row.name, row.status, state),
            },
      ),
    },
  };
}

/**
 * The same report with the `sdk` row's "latest" cell filled from the newest
 * published tag — a SECOND report, posted after the first.
 *
 * Not folded into `buildDependencyReport`: awaiting it there withheld ten rows
 * of already-parsed data behind a live unauthenticated GitHub call that fills
 * exactly ONE cell. The pin sets no HTTP timeout on that call and the spawn cap
 * above it is 60 s, so on a hung network the customer watched a skeleton for up
 * to a minute with the answer already in memory.
 *
 * `null` = nothing to add (no stable tag, or this envelope has no `sdk` check),
 * so the caller posts nothing more.
 */
export async function withLatestSdk(
  context: vscode.ExtensionContext,
  report: DependencyReport,
  options: { signal?: AbortSignal; refreshLatestSdk?: boolean } = {},
): Promise<DependencyReport | null> {
  const tag = await latestSdkTag(
    context,
    options.refreshLatestSdk === true,
    options.signal,
  );
  if (tag === null) return null;
  const latest: DependencyLatest = { version: tag, kind: "release" };
  let filled = false;
  const rows = report.rows.map((row) => {
    if (row.name !== SDK_ROW_NAME) return row;
    filled = true;
    return {
      ...row,
      latest,
      updateAvailable:
        cliSkew(bareVersion(row.installed), bareVersion(tag) ?? "") ===
        "behind",
    };
  });
  return filled ? { ...report, rows } : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Run one row's action. The caller resolved it by ROW ID against the report it
 * last posted, so neither the command string nor the fix id is ever taken from
 * the webview — a `command` here came out of tan's own envelope.
 */
export function runDependencyAction(
  action: DependencyAction,
  cwd: string | undefined,
): void {
  if (action.kind === "fix") {
    runToolchainFix(action.fixId);
    return;
  }
  // A terminal, not `runInTerminal`: tan's `missingPrerequisites[].command` is
  // a shell command line (`sudo apt-get install -y ninja-build`), and
  // `runInTerminal` builds a `ProcessExecution` from an argv array — splitting
  // the line on whitespace to fit that would mangle any quoted argument. This
  // is the same dispatch `runToolchainFix` already uses for an install step.
  const terminal = vscode.window.createTerminal({
    name: "Alp: install dependency",
    cwd,
  });
  terminal.show(true);
  terminal.sendText(action.command);
}
