// SPDX-License-Identifier: Apache-2.0
//
// Host wiring for the dependency table. TWO doctor runs per report — plain `tan
// doctor` and `tan doctor --build` — merged into one check list, fed to the pure
// planner (`@alp-sdk/core/deps/planner`), plus only the facts tan structurally
// cannot report: the `tan` binary this extension resolved, the versions the
// extension already probed for its own state, and the newest published SDK tag.
//
// Nothing here re-derives a fact tan owns. Where tan is silent the cell is
// `null` (the table renders a dash) and the fix is an issue against tan-cli,
// not a TypeScript computation — that is how tan-cli#104/#105 happened.

import {
  DependencyAction,
  DependencyLatest,
  DependencyReport,
  DependencyStatus,
  DoctorCheckEnvelope,
  DoctorEnvelopeData,
  MissingPrerequisite,
  planDependencyReport,
  TAN_ROW_NAME,
} from "@alp-sdk/core/deps/planner";
import { retargetWestCommand } from "@alp-sdk/core/deps/westCommand";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import * as os from "os";
import * as vscode from "vscode";

import { cliSkew, SUPPORTED_CLI_VERSION } from "../alpCli/service";
import { proxyEnvAdditions, runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  venvWestInTopdir,
  westWorkspaceTopdir,
} from "../environment/vscodeAdapter";
import type { AlpIdeState } from "../ideHub/messages";
import { planFailure, planPrecondition } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { runToolchainFix } from "../toolchain";
import { isRunActive, log, runInTerminal } from "../util";

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

// ── Two doctor runs, one check list ──────────────────────────────────────────

/**
 * The checks PLAIN `tan doctor` owns that `--build` never emits, and that hold
 * without a project.
 *
 * tan puts these on plain `doctor` deliberately and says so:
 * `tan-cli/crates/tan-cli/src/commands/doctor.rs` (v0.4.0) — "these need no
 * `board.yaml`, no workspace and no SDK … `--build` deliberately does NOT get
 * them" (`append_host_environment`), and the same for `append_host_prerequisites`.
 * So `--build` alone is structurally blind to them, and the Dependencies panel —
 * the surface the walkthrough tells a customer to open — had no row for any:
 *
 * - `longPaths`   Windows-only. `LongPathsEnabled = 0` is the STOCK WINDOWS
 *                 DEFAULT, and tan's own wording is that a Zephyr `build/` tree
 *                 "nests deep enough to cross the 260-character MAX_PATH limit,
 *                 and it surfaces as a CMake or compiler error about a file that
 *                 exists". That build death had no row here at all.
 * - `homePath`    a space in the home directory (`C:\Users\Jane Doe`).
 * - `zephyrSdkHost`  whether the Zephyr SDK publishes a build for this host at
 *                 all — the opposite question to `--build`'s `zephyrSdk`, which
 *                 asks whether one is installed.
 * - `hostPrerequisites`  bootstrap's own prerequisite gate, carrying the
 *                 `missingPrerequisites[]` commands.
 * - `lldb`        a PATH probe for the native-host debug flow.
 *
 * VERIFIED against the pinned tan v0.4.0 by running it on this machine, not
 * against tan's `dev`. Note the id is `zephyrSdkHost` — there is no
 * `zephyrSdkAvailableForHost` check in v0.4.0.
 *
 * An ALLOWLIST, unlike the planner's row derivation, and that is a real cost:
 * a host check tan adds to plain `doctor` tomorrow will NOT light up a row here
 * until this set names it. It is an allowlist because plain `doctor` also
 * re-reports `sdk` / `workspace` / `westResolved` (which `--build` already
 * carries, so taking them would render one fact twice under one id and collide
 * the view's row keys) and `workspaceRoot` / `sdkRoot` / `sdkProvenance` /
 * `codeLLDBExtension` (project facts, plus one tan itself can only ever answer
 * "unknown" from a standalone binary). The durable fix is tan-side: a
 * host-versus-project scope on the check envelope, or these checks on `--build`
 * too. Until then this list is the seam.
 *
 * FOUR of the five are unconditional host facts. `lldb` is NOT: tan emits it
 * only for a `DebugTargetKind::NativeHost` target (tan-core's debug doctor), so
 * a project whose target is Yocto userspace gets `gdb` + `cppToolsExtension`
 * instead — and this allowlist takes neither, so that row simply does not
 * appear. Read from the pinned v0.4.0 source; only the native-host branch was
 * driven here, because resolving a target that reaches the other one needs an
 * SDK this machine does not have.
 */
const PLAIN_DOCTOR_HOST_CHECKS: ReadonlySet<string> = new Set([
  "hostPrerequisites",
  "zephyrSdkHost",
  "longPaths",
  "homePath",
  "lldb",
]);

/**
 * The `tan doctor --build` checks that genuinely READ THE PROJECT, and so must
 * not be reported when there is no project.
 *
 * Verified against tan v0.4.0 run on this machine: with no project every one of
 * them answers about whatever directory tan was launched in — `sdk` "no SDK
 * selected", `boardYaml` "board.yaml not found", `workspace` "no Zephyr
 * workspace", `westResolved` "west not found". Every OTHER `--build` check
 * (`git`, `python`, `west`, `cmake`, `ninja`, `dtc`, `gperf`, `zephyrSdk`,
 * `yoctoHost`, `vendorToolchain`) is a PATH or host probe whose answer does not
 * depend on the working directory at all — those are the host facts the panel
 * may always show.
 *
 * `westResolved` is here and `west` is not, deliberately: `westResolved` asks
 * whether west resolves inside the WORKSPACE venv, `west` is a plain PATH probe.
 */
const BUILD_PROJECT_CHECKS: ReadonlySet<string> = new Set([
  "sdk",
  "boardYaml",
  "workspace",
  "westResolved",
]);

/**
 * The status a withheld row carries. Not one of tan's verdicts, on purpose: it
 * must never be counted as a pass, a warn or a fail, and `tallyChecks` only
 * counts tan's three words — the same way tan's own summary ignores its
 * `unknown` status (measured: plain `doctor` reported 12 checks as
 * `pass 4 / warn 3 / fail 4`, the twelfth being `codeLLDBExtension: unknown`).
 */
const NOT_CHECKED = "not checked";

/** Why a project row is missing, said on the row rather than by its absence. */
const WITHHELD_DETAIL =
  "No project folder is open, so this was not checked. Open your Alp SDK " +
  "project folder and refresh — the host tools in this table are checked " +
  "either way.";

/**
 * tan's own arithmetic, re-run over exactly the checks this table shows.
 *
 * Needed because the rows now come from TWO envelopes, so neither envelope's
 * `summary` describes the table any more — and a header reading "0 fail" over a
 * red `longPaths` row is worse than no header. It counts tan's verdict words and
 * derives nothing else; `test/deps.adapter.test.js` pins it against the real
 * v0.4.0 summaries so it stays tan's arithmetic and not a second opinion.
 */
export function tallyChecks(
  checks: readonly { status: string }[],
): DoctorEnvelopeData["summary"] {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    if (
      check.status === "pass" ||
      check.status === "warn" ||
      check.status === "fail"
    ) {
      counts[check.status] += 1;
    }
  }
  return counts;
}

/**
 * Fold the two doctor envelopes into the one the planner reads.
 *
 * Order is `--build`'s, verbatim, with plain `doctor`'s host checks appended —
 * so the block a row came from is visible in the table rather than interleaved
 * away, and `--build`'s rows sit exactly where they sat before.
 *
 * `hasProject === false` replaces each project check IN PLACE with a
 * `not checked` row that says why. In place, not dropped: the shape of the table
 * stays tan's, and a row that vanishes teaches a customer nothing.
 *
 * Pure — exported for the test, which drives it on the real captured envelopes.
 */
export function mergeDoctorEnvelopes(
  build: DoctorEnvelopeData,
  plain: DoctorEnvelopeData | null,
  hasProject: boolean,
): DoctorEnvelopeData {
  const checks: DoctorCheckEnvelope[] = build.checks.map((check) =>
    hasProject || !BUILD_PROJECT_CHECKS.has(check.name)
      ? check
      : {
          name: check.name,
          status: NOT_CHECKED,
          detail: WITHHELD_DETAIL,
          // tan's remedy prose is for the verdict it did not reach. Carrying it
          // onto a row nobody checked would offer a fix for a finding.
          fix: null,
        },
  );
  const seen = new Set(checks.map((check) => check.name));
  for (const check of plain?.checks ?? []) {
    // The guard is not decoration: two rows with one name collide the view's
    // `key={row.name}` and make `runDependencyAction`'s row lookup ambiguous.
    if (PLAIN_DOCTOR_HOST_CHECKS.has(check.name) && !seen.has(check.name)) {
      checks.push(check);
      seen.add(check.name);
    }
  }
  if (!plain) {
    // The host-environment half is missing and the table must say so rather
    // than quietly render as if it had been checked. One row, not five: the
    // reason is one failed run.
    checks.push({
      name: "hostEnvironment",
      status: NOT_CHECKED,
      detail:
        "`tan doctor` did not answer, so the host checks it alone reports " +
        "(Windows long paths, home path, Zephyr SDK host support, bootstrap " +
        "prerequisites) are missing from this table. See the Alp SDK output " +
        "channel.",
      fix: null,
    });
  }
  return {
    checks,
    summary: tallyChecks(checks),
    missingPrerequisites: mergePrerequisites(build, plain),
  };
}

/**
 * The two `missingPrerequisites[]` arrays, `--build`'s first.
 *
 * `undefined` — the planner's "this tan is too old to say" tri-state — survives
 * only when NEITHER envelope carried the key; one that did is an answer.
 * First-write-wins per tool so `--build`'s entry, whose row is the one on
 * screen, is the one its button runs.
 */
function mergePrerequisites(
  build: DoctorEnvelopeData,
  plain: DoctorEnvelopeData | null,
): MissingPrerequisite[] | null | undefined {
  if (build.missingPrerequisites === undefined && !plain) return undefined;
  if (
    build.missingPrerequisites === undefined &&
    plain?.missingPrerequisites === undefined
  ) {
    return undefined;
  }
  const byTool = new Map<string, MissingPrerequisite>();
  for (const entry of [
    ...(build.missingPrerequisites ?? []),
    ...(plain?.missingPrerequisites ?? []),
  ]) {
    if (!byTool.has(entry.tool)) byTool.set(entry.tool, entry);
  }
  return [...byTool.values()];
}

/**
 * Run one doctor invocation and return its `data`, or `null` when it produced
 * nothing this planner can read. The failure is already in the channel
 * (`runAlpCommand` logs the exit code and stderr); `message` is the sentence the
 * panel shows when NOTHING usable came back at all.
 */
async function runDoctor(
  context: vscode.ExtensionContext,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<{ data: DoctorEnvelopeData | null; message: string }> {
  const { outcome } = await runAlpCommand(context, args, cwd, { signal });
  const data = outcome.envelope?.data;
  if (!outcome.envelope || !isDoctorEnvelopeData(data)) {
    log(
      `[deps] \`tan ${args.join(" ")}\` produced no usable envelope: ` +
        outcome.message,
    );
    return { data: null, message: outcome.message };
  }
  return { data, message: outcome.message };
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
 * Build the dependency report: `tan doctor --build` AND plain `tan doctor`,
 * merged into one check list, fed to the pure planner, plus the host-known
 * cells.
 *
 * TWO SPAWNS, not one — and that is a deliberate, stated cost. They run
 * CONCURRENTLY, so opening the panel takes about as long as the slower of the
 * two rather than their sum, but it is twice the process work per refresh. It
 * buys the four checks tan puts on plain `doctor` only; `longPaths` alone is a
 * build that dies in CMake on a stock Windows install with no row anywhere in
 * the IDE to explain it.
 *
 * NO FOLDER OPEN is no longer a refusal. The old refusal closed a cycle a
 * customer following the published walkthrough could not break: the prerequisite
 * table needed a folder, the folder needed the SDK, the SDK needed git, and git
 * was installed from the prerequisite table. Host-tool checks are host facts, so
 * they now run with no folder; the four checks that read the project are
 * withheld and SAY they were withheld (`mergeDoctorEnvelopes`), because a
 * project check answered against no project — "board.yaml not found" about a
 * directory the customer never chose — is worse than the refusal was.
 *
 * `state` is the shared `AlpIdeState` the panel already subscribes to — passed
 * in rather than re-probed, so this adds no readiness query of its own.
 */
export async function buildDependencyReport(
  context: vscode.ExtensionContext,
  state: AlpIdeState,
  options: { signal?: AbortSignal } = {},
): Promise<DependencyReportResult> {
  const project = collectProjectContext();
  // cwd, always, explicitly (#371): doctor discovers the project from where it
  // runs and tan 0.4.0+ walks UP looking for an enclosing SDK, so with none
  // passed the child inherits the extension host's own directory — on Windows
  // the VS Code install directory — and reports on a directory nobody chose.
  // With no folder open the temp directory is the honest stand-in: it exists on
  // every host, it is nobody's project, and every check whose answer would
  // depend on it is withheld below rather than reported.
  const hasProject = project.workspaceRoot !== null;
  const cwd = project.workspaceRoot ?? os.tmpdir();
  const [build, plain] = await Promise.all([
    runDoctor(context, ["doctor", "--build"], cwd, options.signal),
    runDoctor(context, ["doctor"], cwd, options.signal),
  ]);
  if (!build.data) {
    // `--build` carries every PATH probe in the table, so losing it is losing
    // the table. Plain `doctor`'s five host rows do not stand in for that, and
    // a five-row table that looks complete would be the worse answer.
    return { report: null, error: build.message };
  }
  const data = mergeDoctorEnvelopes(build.data, plain.data, hasProject);

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
 * tan's own check name for the Zephyr SDK toolchain row — the ONE row whose
 * install command needs retargeting onto this host's venv `west` and a run
 * from the west workspace's own topdir.
 *
 * Gating on the ROW rather than "does the command start with `west`": the
 * `workspace` and `westResolved` rows also carry a `west …` command through
 * `missingPrerequisites` (`FIX_IDS` in the planner covers both with a fallback
 * fix), and `west init` / `west update` must not be mislabelled "Installing
 * the Zephyr SDK", nor refused for lacking the very topdir they exist to
 * create.
 */
const ZEPHYR_SDK_CHECK_NAME = "zephyrSdk";

/**
 * Run one row's action. The caller resolved it by ROW ID against the report it
 * last posted, so neither the command string, the fix id, nor `rowName` is
 * ever taken from the webview — they all came out of tan's own envelope.
 *
 * An options object, not four positional parameters: `rowName` and `cwd` are
 * both plain strings, so swapping them at a call site type-checks silently —
 * a shape only a test that actually asserts on `cwd` would catch, and the
 * winget test that predates this signature did not.
 *
 * `sevenZipStatus` is tan's own `sevenZip` check row's status (undefined when
 * that envelope carried no such row) — read only by the `zephyrSdk` branch's
 * post-install notice, and never re-probed here: tan owns that fact.
 */
export function runDependencyAction(options: {
  action: DependencyAction;
  rowName: string;
  cwd: string | undefined;
  sevenZipStatus: DependencyStatus | undefined;
}): void {
  const { action, rowName, cwd, sevenZipStatus } = options;
  if (action.kind === "fix") {
    runToolchainFix(action.fixId);
    return;
  }
  if (rowName === ZEPHYR_SDK_CHECK_NAME) {
    runZephyrSdkInstall(action.command, sevenZipStatus);
    return;
  }
  // A terminal, not `runInTerminal`: tan's `missingPrerequisites[].command` is
  // a shell command line (`sudo apt-get install -y ninja-build`), and
  // `runInTerminal` builds a `ProcessExecution` from an argv array — splitting
  // the line on whitespace to fit that would mangle any quoted argument. This
  // is the same dispatch `runToolchainFix` already uses for an install step.
  runInNewTerminal(action.command, cwd);
}

/**
 * The dedicated `runInTerminal` run name for the Zephyr SDK install, distinct
 * from `runInNewTerminal`'s `"Alp: install dependency"`: with a `winget`
 * terminal already open under that name, a refused second `zephyrSdk` press
 * would offer "Show Terminal" for a name shared with an unrelated install —
 * revealing the wrong one.
 */
const ZEPHYR_SDK_RUN_NAME = "Alp: install Zephyr SDK";

/**
 * tan owns WHAT to run (the command string, verbatim); the host owns WHERE
 * and WITH WHICH binary. `west sdk install …` names a binary this host does
 * NOT put on PATH (`tan bootstrap` installs it into the workspace venv) and
 * must run from the west workspace's own top-level directory, not wherever
 * the project happens to be — this is the one place that decides both.
 *
 * Dispatches via `runInTerminal` (an argv `ProcessExecution`, no shell) rather
 * than `sendText` into a wrapper shell: a quoted Windows venv path put
 * PowerShell — the default terminal profile on Windows — into EXPRESSION
 * mode, so the quoted path parsed as a string literal instead of a command
 * (measured: `Unexpected token '-v' in expression or statement`).
 * `retargetWestCommand` hands back an argv array for exactly this reason, and
 * `runInTerminal` also gets the real exit code and the concurrent-run guard
 * `sendText` never had — reused here, not re-implemented, via `isRunActive`.
 *
 * Carries `proxyEnvAdditions()`: this is the one west run in the extension
 * that downloads a gigabyte-class toolchain archive, and every other
 * network-bound child process (`tan` itself, `west update`, the SDK-install
 * `git clone`) already carries the same proxy gap-fillers.
 */
function runZephyrSdkInstall(
  command: string,
  sevenZipStatus: DependencyStatus | undefined,
): void {
  const project = collectProjectContext();
  const topdir = westWorkspaceTopdir(project.westCwd, project.sdkRoot);
  if (topdir === null) {
    // No west workspace at all. `tan bootstrap` both creates one and installs
    // `west` into it, so the panel's own Bootstrap offer is the fix, and the
    // shared precondition already says exactly this — a terminal here would
    // only print west's own "not in a west installation", trading one dead
    // end for another.
    notifyAsync(
      planPrecondition("noZephyrWorkspace", {
        dedupeKey: "deps-zephyr-sdk-no-workspace",
      }),
    );
    return;
  }
  const west = venvWestInTopdir(topdir);
  if (west === null) {
    // A topdir resolves (an ambient `$ZEPHYR_BASE`, or a bare `.west/config`
    // ancestor with no bootstrap venv under it — issue #349's mixed state)
    // but its venv has no `west`. "No Zephyr workspace yet" would be FALSE
    // here — one exists at `topdir` — so `planPrecondition` has no id for
    // this; this is the one hand-built plan kept for exactly that gap, same
    // severity rule as every precondition (`planPrecondition`'s own "ALWAYS
    // warning, never error": a missing venv is a setup gap, not a fault) and
    // the same fix action.
    notifyAsync(
      planFailure({
        operation: "Installing the Zephyr SDK",
        cause:
          "No `west` was found in the workspace venv. Bootstrap the Alp SDK " +
          "toolchain to create it, then try again.",
        severity: "warning",
        actions: [{ id: "bootstrap" }],
        dedupeKey: "deps-zephyr-sdk-no-venv",
      }),
    );
    return;
  }
  const argv = retargetWestCommand(command, west);
  if (argv === null) {
    // Not actually a plain `west …` command (a quoted argument, or tan
    // changed the shape) — fall back to the ordinary shell dispatch rather
    // than drop the button. Still `topdir`, not the open project's cwd: this
    // is still `west sdk install`, which still needs its own workspace root —
    // falling back to a DIFFERENT cwd here would fail it a second, unrelated
    // way on top of the un-retargeted binary.
    runInNewTerminal(command, topdir);
    return;
  }
  // `runInTerminal` may refuse a concurrent press for this name (a second
  // Install click while one is already running) rather than start a second
  // one — in which case it already told the customer why, and a "press
  // Refresh" notice on top would read as if a NEW install just started.
  const alreadyRunning = isRunActive(ZEPHYR_SDK_RUN_NAME);
  runInTerminal({
    name: ZEPHYR_SDK_RUN_NAME,
    argv,
    cwd: topdir,
    env: proxyEnvAdditions(),
  });
  if (!alreadyRunning) offerRefreshAfterZephyrSdkInstall(sevenZipStatus);
}

function runInNewTerminal(command: string, cwd: string | undefined): void {
  const terminal = vscode.window.createTerminal({
    name: "Alp: install dependency",
    cwd,
  });
  terminal.show(true);
  terminal.sendText(command);
  offerReloadAfterInstall();
}

/**
 * The notice a terminal install cannot give itself.
 *
 * `winget install …` puts the tool on the MACHINE's PATH; the running extension
 * host inherited its environment at launch and never sees it. So the row the
 * customer just fixed still reads `fail / ninja not found` after a successful
 * install, and nothing on screen says why or what to do — the panel looks
 * broken and the fix looks like it did nothing.
 *
 * NO `reloadWindow` BUTTON, and that is deliberate rather than an omission.
 * Reload re-forks the extension host from a main process whose environment was
 * captured when VS Code started — on Windows VS Code skips shell-environment
 * resolution outright — so a reload inherits exactly the same stale PATH and
 * cannot turn the row green. Offering it would be a wrong diagnosis with a
 * button attached, and pressing it mid-install would dispose the terminal and
 * kill the install this very notice warns about.
 *
 * What DOES work, in order: Refresh is usually enough, because winget's shim
 * lands in a directory that was already on PATH at launch and `cp.spawn`
 * resolves the file rather than a cached lookup. When it is not enough, only
 * quitting VS Code completely and reopening picks up a new PATH.
 *
 * Shown at DISPATCH, before the install finishes, because `sendText` writes a
 * shell command line and there is no completion signal to wait for (that is the
 * same reason the dispatch above is a terminal and not a `ProcessExecution`).
 *
 * `notifyAsync`, not `notify`: this is called from the webview's message pump.
 */
function offerReloadAfterInstall(): void {
  notifyAsync(
    planFailure({
      operation: "Installing a dependency",
      cause:
        "Installing in the terminal. When it finishes, press Refresh. This " +
        "window's PATH was captured when VS Code started, so if the row still " +
        "reads as missing, close VS Code completely and reopen it — a window " +
        "reload does not pick up a new PATH.",
      severity: "info",
      // One install at a time on screen: pressing Install on three rows must
      // not stack three identical toasts.
      dedupeKey: "deps-install-reload",
    }),
  );
}

/**
 * The zephyrSdk branch's own "press Refresh" notice — deliberately NOT
 * `offerReloadAfterInstall`, whose prose is PATH-specific ("This window's PATH
 * was captured when VS Code started…"). The Zephyr SDK row does not flip on
 * PATH at all — tan's `zephyrSdk` check reads the SDK install directory, so a
 * plain Refresh always picks up a completed install with no restart needed,
 * and asserting otherwise would be a wrong diagnosis attached to a real
 * button.
 *
 * Folds in tan's own `sevenZip` verdict — never re-probed here, only read —
 * when it is anything but `pass` on win32: the one host where west delegates
 * `.7z` extraction to an external 7-Zip binary (`patoolib`, no pure-Python
 * fallback), so a missing one fails the install after this notice already
 * promised "when it finishes, press Refresh" with no reason given. tan grades
 * the check `Warn`, not `Fail` — a missing extractor blocks THIS remedy, not
 * the build, and the customer may have one tan did not detect — so this never
 * refuses the dispatch, only says so up front.
 */
function offerRefreshAfterZephyrSdkInstall(
  sevenZipStatus: DependencyStatus | undefined,
): void {
  const needsSevenZip =
    process.platform === "win32" &&
    sevenZipStatus !== undefined &&
    sevenZipStatus !== "pass";
  notifyAsync(
    planFailure({
      operation: "Installing the Zephyr SDK",
      cause: needsSevenZip
        ? "Installing in the terminal. When it finishes, press Refresh. On " +
          "native Windows a 7-Zip binary (7z / 7za / 7zr / 7zz / 7zzs / unar) " +
          "must be on PATH first, or the extraction step fails."
        : "Installing in the terminal. When it finishes, press Refresh.",
      severity: needsSevenZip ? "warning" : "info",
      dedupeKey: "deps-zephyr-sdk-reload",
    }),
  );
}
