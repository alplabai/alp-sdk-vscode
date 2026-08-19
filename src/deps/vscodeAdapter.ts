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
  DependencyRow,
  DependencyStatus,
  DoctorCheckEnvelope,
  DoctorEnvelopeData,
  MissingPrerequisite,
  planDependencyReport,
  TAN_ROW_NAME,
} from "@alp-sdk/core/deps/planner";
import {
  type ConsentItem,
  planInstallConsent,
} from "@alp-sdk/core/deps/consent";
import { retargetWestCommand } from "@alp-sdk/core/deps/westCommand";
import {
  type BootstrapHost,
  bootstrapHost,
} from "@alp-sdk/core/toolchain/bootstrapPlan";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import * as os from "os";
import * as vscode from "vscode";

import { cliSkew, SUPPORTED_CLI_VERSION } from "../alpCli/service";
import { runDoctor } from "../alpCli/doctor";
import { proxyEnvAdditions, runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  venvWestInTopdir,
  westWorkspaceTopdir,
} from "../environment/vscodeAdapter";
import { type AlpIdeState, BOOTSTRAP_RUN_NAME } from "../ideHub/messages";
import { planFailure, planPrecondition } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { runToolchainFix, TOOLCHAIN_FIX_RUN_NAME } from "../toolchain";
import { awaitRun, isRunActive, log, runInTerminal } from "../util";

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
  // `interactive: force` — `force` IS "the user explicitly asked for a
  // refresh" (this function's own opening doc, and `refreshDependencies` in
  // `deps/panel.ts` is its one caller that passes `true`), so it doubles as
  // the direct-ask signal ADR 0021 needs: ask consent on an explicit Refresh
  // click, never on the window-focus/settings-edit/bootstrap-boundary
  // re-derives that pass `false` here.
  const { outcome } = await runAlpCommand(context, ["sdk", "list"], undefined, {
    signal,
    interactive: force,
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
 * - `zephyrSdkAvailableForHost`  whether the Zephyr SDK publishes a build for
 *                 this host at all — the opposite question to `--build`'s
 *                 `zephyrSdk`, which asks whether one is installed.
 * - `hostPrerequisites`  bootstrap's own prerequisite gate, carrying the
 *                 `missingPrerequisites[]` commands.
 * - `lldb`        a PATH probe for the native-host debug flow.
 *
 * RE-DERIVED against the pinned tan 0.5.1 (#472). What the measurement found,
 * recorded so the next pin bump starts from facts rather than this prose:
 *
 *  - `zephyrSdkHost` is GONE and `zephyrSdkAvailableForHost` is emitted in its
 *    place — a rename, and the one entry that was actively wrong. Under v0.4.0
 *    this list named a check the binary no longer has, so the row it was meant
 *    to admit was never admitted.
 *  - `longPaths` and `lldb` were NOT observed. They are kept anyway, and that is
 *    deliberate: the measurement ran on darwin against a project whose debug
 *    target is not `NativeHost`, and `longPaths` reads as Windows-only. Dropping
 *    a platform-conditional check because one host did not emit it is the exact
 *    mistake that produced this issue. `plainDoctorAllowlistDrift` now reports
 *    from real machines instead, including the Windows ones this cannot reach.
 *  - On 0.5.1 plain `doctor` and `doctor --build` emit the IDENTICAL check set —
 *    14 names with no project, 17 with one. Since the merge below only takes a
 *    plain check when `--build` did not already carry that name, the loop adds
 *    nothing at all on this pin. The second subprocess is currently pure cost.
 *    It is kept because deleting a seam on one pin's behaviour is how this
 *    allowlist rotted in the first place, and because the durable fix is the
 *    upstream one named below — but if tan ships a host-vs-project scope, this
 *    whole path should go rather than be re-derived a third time.
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
  "zephyrSdkAvailableForHost",
  "longPaths",
  "homePath",
  "lldb",
]);

/**
 * Allowlist entries kept for an OLDER tan than the pin, and therefore not drift.
 *
 * `zephyrSdkHost` is the pre-0.5.x spelling of `zephyrSdkAvailableForHost`.
 * Both are in the allowlist because an extra entry costs nothing — the merge
 * only admits a name the envelope actually carries, and the `!seen` guard stops
 * a duplicate — while a MISSING one silently drops a row, which is #472.
 *
 * Listed here so the drift report does not cry wolf about an entry we keep on
 * purpose. Everything not in this set is a genuine "the pinned binary does not
 * emit what this list names".
 */
const LEGACY_PLAIN_DOCTOR_CHECKS: ReadonlySet<string> = new Set([
  "zephyrSdkHost",
]);

/**
 * The allowlist entries the plain `doctor` envelope did NOT emit.
 *
 * This is the answer to #472's actual finding. The defect there was never the
 * five strings — it was that a stale one vanishes in silence: an entry naming a
 * check tan no longer has simply admits no row, and a missing row reads as "not
 * a problem" rather than "not asked". `zephyrSdkHost` sat wrong across two pin
 * bumps because nothing anywhere said so.
 *
 * A build-time gate is not available: the vendored contract corpus
 * (`test/golden/tan-contract/`, tan 0.5.1) carries 17 envelopes and none of them
 * is `doctor`, so CI has no captured envelope to assert against. This runs on
 * the customer's actual pinned binary instead, which is strictly better for the
 * two entries a developer machine cannot settle — `longPaths` (Windows) and
 * `lldb` (native-host debug targets only).
 *
 * Returns names, not a verdict. Drift is not itself a failure: tan may
 * legitimately stop emitting a check on a host or a target where it does not
 * apply. The caller logs; nothing is failed on the customer's behalf.
 *
 * Pure — exported for the test.
 */
export function plainDoctorAllowlistDrift(
  plain: DoctorEnvelopeData | null,
): string[] {
  if (!plain) return [];
  const emitted = new Set(plain.checks.map((check) => check.name));
  return [...PLAIN_DOCTOR_HOST_CHECKS].filter(
    (name) => !emitted.has(name) && !LEGACY_PLAIN_DOCTOR_CHECKS.has(name),
  );
}

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

// The shared `runDoctor` spawn (`../alpCli/doctor`, #376) takes `interactive`
// as its last argument:
//
// `false` for the panel's own re-derives (window focus, settings edit,
// bootstrap start/end — DependencyPanel's `onStateChange`) and for the
// initial `ready` open, so none of those pops ADR 0021's consent modal out of
// nowhere. `true` only for the explicit Refresh click (`refreshDependencies`,
// `deps/panel.ts`), which already carries this distinction as
// `refreshLatestSdk` — threaded through below under its own name so a Refresh
// click is not silently refused with consent unanswered.
//
// Note what this is NOT the remedy for: the `tan` row has no action
// (`action: null`, `packages/alp-core/src/deps/planner.ts`) — its own
// install/update path lives in `src/alpCli/`, not a row button, so a
// declined/unanswered consent here does not leave a dangling button. It
// leaves NO table at all: `build.data` is null, so `buildDependencyReport`
// returns `report: null` and the panel shows its inline error text instead.

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
  // `interactive` — see `runDoctor`'s doc: default false (window focus,
  // settings edit, bootstrap boundary, the initial `ready` open), `true` only
  // when the caller is the explicit Refresh click.
  options: { signal?: AbortSignal; interactive?: boolean } = {},
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
  const interactive = options.interactive === true;
  const [build, plain] = await Promise.all([
    runDoctor(context, ["doctor", "--build"], cwd, options.signal, interactive),
    runDoctor(context, ["doctor"], cwd, options.signal, interactive),
  ]);
  if (!build.data) {
    // `--build` carries every PATH probe in the table, so losing it is losing
    // the table. Plain `doctor`'s five host rows do not stand in for that, and
    // a five-row table that looks complete would be the worse answer.
    return { report: null, error: build.message };
  }
  // #472: say it out loud when an allowlist entry names a check the pinned tan
  // does not emit. Silence is the defect — a stale entry admits no row, and a
  // row that is absent reads as "fine" rather than "never asked".
  const drift = plainDoctorAllowlistDrift(plain.data);
  if (drift.length > 0) {
    log(
      `[deps] plain doctor emitted no ${drift.join(", ")} — the ` +
        `PLAIN_DOCTOR_HOST_CHECKS allowlist may need re-deriving against ` +
        `tan ${SUPPORTED_CLI_VERSION} (see #472). Platform- or target-` +
        `conditional checks legitimately appear here on some hosts.`,
    );
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
  // tan's `missingPrerequisites[].command` is a shell command LINE (`sudo
  // apt-get install -y ninja-build`). This used to be a bare terminal because
  // `runInTerminal` only spoke argv, and splitting the line on whitespace to
  // fit that mangles any quoted argument. `runInTerminal` now takes a
  // `command` too (a ShellExecution — see `RunExecutionSpec`), so the line
  // still reaches a shell verbatim AND the run gets an exit code and a
  // reservation, which is what a sequential "Fix all" waits on (#466 §2).
  runInNewTerminal(action.command, cwd);
}

/** The run name every plain dependency install claims — see
 *  `ZEPHYR_SDK_RUN_NAME` for why that one keeps its own. */
const INSTALL_RUN_NAME = "Alp: install dependency";

/**
 * The run name a given row's action will claim, or `null` when pressing it
 * starts nothing to wait for (a pointer that only opens a page).
 *
 * A sequential "Fix all" needs this BEFORE dispatching: `awaitRun` has to be
 * subscribed first, and `isRunActive` has to be checked first — a dispatch
 * `runInTerminal` refuses reserves nothing and fires nothing, so awaiting it
 * would hang forever.
 */
export function runNameFor(row: DependencyRow): string | null {
  if (!row.action) return null;
  if (row.action.effect === "open-docs") return null;
  if (row.action.effect === "bootstrap") return BOOTSTRAP_RUN_NAME;
  if (row.name === ZEPHYR_SDK_CHECK_NAME) return ZEPHYR_SDK_RUN_NAME;
  return row.action.kind === "fix" ? TOOLCHAIN_FIX_RUN_NAME : INSTALL_RUN_NAME;
}

/**
 * The rows a "Fix all" would actually run, in the planner's order.
 *
 * Exactly the `will-install` set (#466 §1): a row whose only action opens a
 * web page installs NOTHING, so counting it would make the button's number a
 * promise it cannot keep. What is left out is reported, never quietly dropped
 * — see the button's tooltip and the summary toast.
 */
export function fixAllTargets(report: DependencyReport): DependencyRow[] {
  return report.rows.filter((row) => row.state === "will-install");
}

/** What a "Fix all" run did, so the caller can say it rather than guess. */
export interface FixAllOutcome {
  installed: string[];
  /** Rows whose run exited non-zero, each with the code. */
  failed: { name: string; code: number | undefined }[];
  /** Rows never started, because the user cancelled or a run was already
   *  holding the slot. Reported, never silently dropped. */
  skipped: { name: string; reason: string }[];
}

/**
 * A consent line, plus the row it consents to. The row is the OBJECT the loop
 * will dispatch, not a name to look up again — that identity is what makes it
 * impossible for this screen to name a different artifact than the one that
 * runs, the same structural guarantee the tan-binary dialog has
 * (`test/alpCli.downloadConsent.test.js:268` / `:280`).
 */
interface ConsentPick extends vscode.QuickPickItem {
  name: string;
  row: DependencyRow;
}

/** What a cell says when no producer reports it (alp-sdk#1574). */
const NOT_REPORTED = "not reported";

/** One consent line: artifact on the label, the four ADR 0021 §3 facts under it. */
function consentPick(item: ConsentItem, row: DependencyRow): ConsentPick {
  return {
    name: item.name,
    row,
    label: item.artifact,
    // The elevation note goes HERE, beside the label, because it is the one
    // fact that changes what a customer is agreeing to rather than merely
    // describing it. Derived from the command text tan emitted, never from the
    // tool's name — see `@alp-sdk/core/deps/consent`.
    description: item.needsElevation ? "requires elevation" : "",
    detail:
      `Runs: ${item.source ?? NOT_REPORTED} · ` +
      `Size: ${item.size ?? NOT_REPORTED} · ` +
      `Licence: ${item.licence ?? NOT_REPORTED}`,
    picked: true,
  };
}

/**
 * ADR 0021 §3's ONE consent screen, over a whole install set (#467).
 *
 * Until this landed, pressing "Fix all" dispatched the first installer
 * immediately and asked nothing — while the far smaller act of downloading the
 * `tan` binary has needed a consent click since #434. This closes that
 * asymmetry.
 *
 * ONE screen, never one per row: #467 names N modal dialogs during a Fix-all as
 * the failure mode, which is also why this is a multi-select QuickPick rather
 * than a modal. A modal has buttons, so per-item skipping would have to become
 * per-item modals — the very thing being avoided. Every line starts CHECKED, so
 * the default answer is the one the customer already asked for by pressing the
 * button, and skipping is an opt-out.
 *
 * Returns the consented rows (a subset of `rows`, same objects, same order), or
 * `null` when the screen was dismissed. `null` and `[]` are deliberately
 * different: dismissed means "no answer", empty means "answered, none of them",
 * and the caller reports them with different words.
 *
 * NO TIERS. ADR 0021 §3 asks for three, and no producer can express one today —
 * measured, and filed as alp-sdk#1574. The alternative #467 explicitly rules
 * out is a local table keyed on tool name, so what ships is the screen without
 * the tiering rather than a tiering this extension invented.
 */
export async function confirmDependencyInstalls(
  rows: DependencyRow[],
  host: BootstrapHost = bootstrapHost(),
): Promise<DependencyRow[] | null> {
  if (rows.length === 0) return [];
  const picks = planInstallConsent(rows, host).map((item, index) =>
    consentPick(item, rows[index]),
  );
  const picked = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    title: "Alp: install dependencies",
    placeHolder:
      "These will be installed on this machine. Uncheck anything you do not want.",
    // A long install list plus a click on another editor must not silently
    // answer this for the customer.
    ignoreFocusOut: true,
  });
  if (picked === undefined) return null;
  return picked.map((pick) => pick.row);
}

/**
 * Run every installing row, ONE AT A TIME, waiting for each to finish (#466 §2).
 *
 * SEQUENTIAL is the whole design, not a simplification. Two installers racing
 * is the failure `planDependencyReport` already suppresses every action to
 * avoid — "a second installer racing it is how half-written workspaces
 * happen" — and several of these fixes mutate the same venv, the same west
 * workspace, or the same machine-wide package manager. Firing them together
 * would also lose to the run reservations: `runInTerminal` REFUSES a name that
 * is already active, so a parallel dispatch would silently drop rows and
 * report success.
 *
 * Stops at the first failure. A toolchain is a chain: `west` failing to
 * install makes the `west-workspace` step after it fail for a reason that has
 * nothing to do with the workspace, and a wall of consequential errors is
 * worse than one real one.
 *
 * Cancellation stops the sequence but never kills a run already in flight —
 * the same rule as everywhere else in this extension, because a live run can
 * be a flash and killing that mid-write can leave a board unbootable (#146).
 * A cancel between steps is exactly what it says: no further steps.
 */
export async function runFixAll(options: {
  report: DependencyReport;
  cwd: string | undefined;
  token: vscode.CancellationToken;
  /** Called before each row starts, for a progress line naming what runs. */
  onStep?: (row: DependencyRow, index: number, total: number) => void;
}): Promise<FixAllOutcome> {
  const { report, cwd, token, onStep } = options;
  const targets = fixAllTargets(report);
  const outcome: FixAllOutcome = { installed: [], failed: [], skipped: [] };
  // Nothing to install asks nothing: a consent screen whose only honest answer
  // is "install nothing" is a dialog with no question in it.
  if (targets.length === 0) return outcome;

  // ADR 0021 §3 (#467). BEFORE the first dispatch, and over the whole set —
  // this is the one place that decides, so no caller can reach the loop with
  // the gate skipped. Built from `targets` itself, so the set offered and the
  // set run are the same row objects.
  const consented = await confirmDependencyInstalls(targets);
  if (consented === null) {
    for (const target of targets) {
      outcome.skipped.push({ name: target.name, reason: "consent not given" });
    }
    log(`[fix-all] consent declined for ${targets.length} row(s)`);
    return outcome;
  }
  const allowed = new Set(consented);

  const sevenZip = report.rows.find((row) => row.name === "sevenZip");

  for (const [index, row] of targets.entries()) {
    if (!allowed.has(row)) {
      // Named with its reason, like every other non-run: "3 skipped" with no
      // reason is the silent truncation this panel exists to avoid.
      outcome.skipped.push({
        name: row.name,
        reason: "left unchecked on the consent screen",
      });
      continue;
    }
    if (token.isCancellationRequested) {
      outcome.skipped.push({ name: row.name, reason: "cancelled" });
      continue;
    }
    const runName = runNameFor(row);
    if (runName === null) {
      // `fixAllTargets` should have excluded these, so reaching here means the
      // state mapping and the dispatch disagree. Say so rather than pressing on.
      outcome.skipped.push({ name: row.name, reason: "nothing to wait for" });
      continue;
    }
    if (isRunActive(runName)) {
      // The dispatch would be REFUSED, reserving nothing and firing nothing,
      // so awaiting it would hang forever. Skip it and say why.
      outcome.skipped.push({
        name: row.name,
        reason: `"${runName}" is already running`,
      });
      continue;
    }

    onStep?.(row, index, targets.length);
    log(`[fix-all] ${row.name}: starting "${runName}"`);
    // Subscribed BEFORE the dispatch: a fast install can finish before a
    // promise created afterwards ever attaches.
    const finished = awaitRun(runName);
    runDependencyAction({
      // Narrowed by `fixAllTargets` — a `will-install` row always has one.
      action: row.action as DependencyAction,
      rowName: row.name,
      cwd,
      sevenZipStatus: sevenZip?.status,
    });
    const code = await finished;
    log(`[fix-all] ${row.name}: exited (code=${code ?? "unknown"})`);

    // `undefined` is "the task never started or the code is unknown", which is
    // not a success — treating it as one is how a Fix-all reports green over a
    // task type that was never contributed.
    if (code === 0) {
      outcome.installed.push(row.name);
      continue;
    }
    outcome.failed.push({ name: row.name, code });
    for (const rest of targets.slice(index + 1)) {
      outcome.skipped.push({
        name: rest.name,
        reason: `stopped after ${row.name} failed`,
      });
    }
    break;
  }

  return outcome;
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
  runInTerminal({ name: INSTALL_RUN_NAME, command, cwd });
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
