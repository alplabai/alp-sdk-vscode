// SPDX-License-Identifier: Apache-2.0
//
// Host wiring for the dependency table. ONE `tan doctor` run per report, fed to
// the pure planner (`@alp-sdk/core/deps/planner`), plus only the facts tan
// structurally cannot report: the `tan` binary this extension resolved, the
// versions the extension already probed for its own state, and the newest
// published SDK tag.
//
// IT USED TO BE TWO RUNS (#544). Plain `tan doctor` AND `tan doctor --build`,
// concurrently, merged through an allowlist — because on tan v0.4.0 the two
// genuinely returned different check sets and `--build` was structurally blind
// to five host checks. That stopped being true two pins ago. At
// SUPPORTED_CLI_VERSION the flag is a no-op whose own help says so — "Accepted
// for compatibility (tan-cli#290): zephyrWorkspace, the check this used to
// gate, now runs unconditionally, so this flag no longer changes the check
// list" — and the two envelopes are IDENTICAL: same 14 checks, same verdicts,
// byte-for-byte equal apart from `generatedAt`. The second spawn bought
// nothing, and the allowlist that split the merged rows was splitting them on
// a distinction the binary no longer draws.
//
// THAT IS TRUE OF THE PIN AND ONLY OF THE PIN. `alpSdk.cliPath` still reaches
// a pre-0.5 binary where the two envelopes differ completely, and dropping the
// `--build` arm on one of those is dropping every PATH probe in the table. The
// old two-spawn code guarded that with "no `--build` data, no report"; the
// single-envelope form of the same guard is `carriesToolchainProbes` below,
// which refuses rather than rendering a gutted table that looks complete.
//
// Nothing here re-derives a fact tan owns. Where tan is silent the cell is
// `null` (the table renders a dash) and the fix is an issue against tan-cli,
// not a TypeScript computation — that is how tan-cli#104/#105 happened.

import {
  DependencyAction,
  type DependencyCommandStep,
  DependencyLatest,
  DependencyReport,
  DependencyRow,
  DependencyStatus,
  DoctorCheckEnvelope,
  DoctorEnvelopeData,
  type MissingPrerequisite,
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
import { narrowSdkReleases } from "@alp-sdk/core/sdk/service";
import * as vscode from "vscode";

import {
  cliSkew,
  isCliBehind,
  sdkListAnswered,
  SUPPORTED_CLI_VERSION,
  unansweredSdkListCodes,
} from "../alpCli/service";
import { runDoctor } from "../alpCli/doctor";
import { proxyEnvAdditions, runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  venvWestInTopdir,
  westWorkspaceTopdir,
} from "../environment/vscodeAdapter";
import { type AlpIdeState, BOOTSTRAP_RUN_NAME } from "../ideHub/messages";
import { planFailure, planPrecondition } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import {
  collectProjectContext,
  readOnlyProjectCwd,
} from "../project/vscodeAdapter";
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
 * The request IS bounded, RE-MEASURED against the pinned 0.6.0 rather than
 * carried forward from the v0.4.0 Rust build this paragraph used to cite
 * (`http.rs`'s shared agent no longer describes a Python binary): pointing
 * `HTTPS_PROXY` at a black-hole address returns a clean `sdk.fetch-failed` /
 * `<urlopen error timed out>` after roughly 20s, not a hang. v0.3.1 and
 * earlier set none — still reachable through `alpSdk.cliPath` — and the rate
 * budget argument above holds either way, so the cache stays.
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
 * owns the fact again. That flag is the tan-cli-side ask — filed as
 * tan-cli#887, which asks for `draft` too: a draft release is invisible to an
 * unauthenticated fetch, so a consumer that starts seeing one has a different
 * problem than one seeing a prerelease and cannot tell them apart from the tag
 * either. This reads a tag because today there is nothing else to read.
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
  // `--online` is what lets `list` query the GitHub releases API at all. The
  // sibling reader (`src/ideHub/sdkManagerMessages.ts`) has always passed it;
  // this one did not, and that omission is half of #542.
  //
  // `readOnlyProjectCwd()`, not `undefined` (#605): `sdk` resolves a project
  // and an SDK from cwd, so an omitted one answers about the extension
  // host's own directory instead of the customer's project — the same
  // hazard `buildDependencyReport` documents for `doctor` below. The two
  // issue codes this could surface, `sdk.project-pin-unresolved` and
  // `sdk.discovery-divergent`, are `"status": "reserved"` / `"consumer":
  // "none"` in `test/golden/tan-contract/envelope-contract.json` — which
  // means no consumer in THIS extension binds them, not that tan does not
  // emit them; the registry names an `emittedBy` for each. See
  // `readOnlyProjectCwd`'s own doc for why neither this site nor
  // its sibling in `src/ideHub/sdkManagerMessages.ts` withholds a
  // project-scoped issue the way `withheldProjectChecks` does for `doctor`.
  const { outcome } = await runAlpCommand(
    context,
    ["sdk", "list", "--online"],
    readOnlyProjectCwd(),
    {
      signal,
      interactive: force,
    },
  );
  const envelope = outcome.envelope;
  if (!envelope || !envelope.ok) {
    log(`[deps] latest-SDK lookup unavailable: ${outcome.message}`);
    // The last known answer beats a dash, and it is stamped — a stale tag stays
    // stale, so the next open retries. Null only when nothing was ever cached.
    return cache?.tag ?? null;
  }
  // The other half: `ok: true` is not "I have the data". tan answers a lookup
  // it could not perform with `ok: true, exitCode: 0, releases: []` and the
  // real answer in a WARNING — "I did not look", not "nothing is published".
  // Caching that writes a FRESH stamp over an absent answer, which suppresses
  // the retry that would fix it, so the dash persists for the whole staleness
  // window. The failure sustains itself.
  if (!sdkListAnswered(envelope)) {
    log(
      `[deps] latest-SDK lookup did not reach the registry (${unansweredSdkListCodes(envelope).join(", ")}) — keeping the last known answer, retrying on the next open`,
    );
    return cache?.tag ?? null;
  }
  // Narrowed, not cast (#611): `envelope.data` is untrusted, and a `releases`
  // entry without a string `tag` used to reach `pickLatestSdkTag`'s `.find`
  // and throw inside `isStableTag`'s `tag.trim()` with no try/catch on this
  // path.
  const releases = narrowSdkReleases(envelope.data);
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

// ── One doctor run, one check list ───────────────────────────────────────────
//
// WHAT WAS HERE, AND WHY IT IS NOT ANY MORE (#472 → #544).
//
// `PLAIN_DOCTOR_HOST_CHECKS`: an allowlist of five check names the merge was
// permitted to take from the plain-`doctor` envelope, because on tan v0.4.0
// `--build` was structurally blind to them (`doctor.rs`'s
// `append_host_environment` — "`--build` deliberately does NOT get them") while
// plain `doctor` ALSO re-reported project facts the `--build` block already
// carried, and taking those would have rendered one fact twice under one row
// key. It was re-derived once, under #472, when `zephyrSdkHost` turned out to
// have been renamed upstream two pins earlier and the row it was meant to admit
// had never been admitted. `plainDoctorAllowlistDrift` was that issue's remedy:
// it logged when the pinned binary emitted nothing for an entry, because a
// stale entry admits no row and an ABSENT row reads as "fine" rather than
// "never asked".
//
// ALL OF IT IS GONE, and #472's defect class goes with it. There is one
// envelope now, so there is nothing to merge, no duplicate row keys to avoid,
// and no allowlist: EVERY check tan reports becomes a row, which is the rule
// this slice states at the top of `deps/planner.ts` and had one exception to.
// An allowlist entry can no longer rot, because there are no entries. That is a
// stronger fix than re-deriving the list a third time would have been, and it
// is the one the #472 comment itself pointed at ("if tan ships a host-vs-
// project scope, this whole path should go rather than be re-derived").
//
// tan shipped exactly that scope, which is what the block below reads.

/** tan's own word for a check that reads the project rather than the host.
 *  Measured on the pinned binary: every check in a `tan doctor` envelope
 *  carries `"scope": "project"` or `"scope": "host"`. */
const PROJECT_SCOPE = "project";

/**
 * The checks to treat as project-scoped when the envelope carries NO `scope`
 * at all — i.e. a pre-0.5 tan reached through `alpSdk.cliPath`.
 *
 * A FALLBACK, and only a fallback. The question this answers — "does this
 * check read the project, so must it be withheld when no folder is open?" —
 * is one TAN ANSWERS ITSELF now, and `isProjectCheck` asks tan first. This
 * list is what is left when tan is too old to be asked.
 *
 * Verified against tan v0.4.0 run on this machine: with no project every one of
 * these four answers about whatever directory tan was launched in — `sdk` "no
 * SDK selected", `boardYaml` "board.yaml not found", `workspace` "no Zephyr
 * workspace", `westResolved` "west not found". Every other v0.4.0 check
 * (`git`, `python`, `west`, `cmake`, `ninja`, `dtc`, `gperf`, `zephyrSdk`,
 * `yoctoHost`, `vendorToolchain`) is a PATH or host probe whose answer does not
 * depend on the working directory at all.
 *
 * `westResolved` is here and `west` is not, deliberately: `westResolved` asks
 * whether west resolves inside the WORKSPACE venv, `west` is a plain PATH probe.
 *
 * IT IS INCOMPLETE FOR THE PIN, and that is exactly why it is not the primary
 * source: the pinned tan scopes `zephyrWorkspace` and `pythonFloor` as
 * `project` too, and neither is named here. A hand list of check names rots the
 * moment tan adds one — that is #472 — so the hand list is now only ever
 * consulted for binaries that predate the field.
 */
const LEGACY_PROJECT_CHECKS: ReadonlySet<string> = new Set([
  "sdk",
  "boardYaml",
  "workspace",
  "westResolved",
]);

/**
 * Whether a check reads the project, so must be withheld with no folder open.
 *
 * tan's `scope` first, ALWAYS — it is the producer's own answer and it cannot
 * go stale here. The fallback runs only when the field is absent entirely.
 *
 * An UNRECOGNISED scope (a third word tan adds later) reads as NOT project:
 * withholding a row on a scope nobody has interpreted would hide a host fact
 * behind a guess, and the failure mode of the other direction — showing a row
 * tan scoped some new way — is that the customer sees one extra true verdict.
 *
 * Pure — exported for the test.
 */
export function isProjectCheck(check: DoctorCheckEnvelope): boolean {
  // Widened on purpose. `scope` is REQUIRED by tan's frozen contract, so the
  // type promises a string — but `isDoctorEnvelopeData` accepts an envelope
  // without it (see its own doc: refusing one would blank the table that
  // reports the skew), so at RUNTIME a pre-0.5 binary can still get here with
  // nothing in this field. The annotation is what makes the fallback below
  // reachable code rather than a branch the compiler has already ruled out.
  const scope: string | undefined = check.scope;
  if (typeof scope === "string") return scope === PROJECT_SCOPE;
  return LEGACY_PROJECT_CHECKS.has(check.name);
}

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
 * Still needed with ONE envelope: `withheldProjectChecks` replaces every
 * project row with `not checked` when no folder is open, so tan's own
 * `summary` describes a table that is not on screen — a header reading "3
 * fail" over three rows that say "not checked" is worse than no header. It
 * counts tan's verdict words and derives nothing else;
 * `test/deps.adapter.test.js` pins it against real captured summaries so it
 * stays tan's arithmetic and not a second opinion.
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
 * The envelope the planner reads, with project checks withheld when there is
 * no project.
 *
 * `hasProject === false` replaces each project-scoped check IN PLACE with a
 * `not checked` row that says why. In place, not dropped: the shape of the
 * table stays tan's, and a row that vanishes teaches a customer nothing.
 *
 * NOTHING IS FILTERED, ADDED OR REORDERED. Every check tan reported is a row,
 * in tan's order — the rule `deps/planner.ts` states and the allowlist this
 * replaced was the one exception to.
 *
 * Pure — exported for the test, which drives it on real captured envelopes.
 */
export function withheldProjectChecks(
  data: DoctorEnvelopeData,
  hasProject: boolean,
): DoctorEnvelopeData {
  if (hasProject) return data;
  const checks: DoctorCheckEnvelope[] = data.checks.map((check) =>
    !isProjectCheck(check)
      ? check
      : {
          name: check.name,
          status: NOT_CHECKED,
          scope: check.scope,
          detail: WITHHELD_DETAIL,
          // tan's remedy prose is for the verdict it did not reach. Carrying it
          // onto a row nobody checked would offer a fix for a finding.
          fix: null,
        },
  );
  return { ...data, checks, summary: tallyChecks(checks) };
}

// ── Is this envelope one the table can be built from at all? ─────────────────
//
// dev held a guard here and #544 deleted it with the second spawn:
//
//     if (!build.data) {
//       // `--build` carries every PATH probe in the table, so losing it is
//       // losing the table. Plain `doctor`'s five host rows do not stand in
//       // for that, and a five-row table that looks complete would be the
//       // worse answer.
//       return { report: null, error: build.message };
//     }
//
// The SPAWN it guarded is correctly gone — `--build` is a documented no-op at
// the pin (tan-cli#290) and restoring it reds the surface gate's inert-flag
// assertion. THE INTENT IS NOT. `alpSdk.cliPath` still reaches a pre-0.5
// binary, and on tan v0.4.0 the two envelopes were never identical: plain
// `doctor` carries NONE of the PATH probes. Measured on the two captured
// fixtures — with a folder open, a v0.4.0 plain envelope produces 12 rows plus
// `tan` and NO row at all for git, python, cmake, ninja, dtc, gperf,
// zephyrSdk, yoctoHost or vendorToolchain, and tan's own fix command for the
// one tool it did name (`missingPrerequisites: [{tool: "ninja", command:
// "winget install -e --id Ninja-build.Ninja"}]`) attaches to no row, so
// `hostPrerequisites` renders `fail` with `action: null`. With NO folder open
// the same envelope additionally renders `workspaceRoot pass C:/tmp/no-project`
// and `sdkRoot fail No alp-sdk checkout resolved.` un-withheld — verdicts about
// `os.tmpdir()` beside six rows saying "No project folder is open", and a red
// row that can contradict the extension's own host-known SDK state.
//
// So the guard comes back, re-expressed against the ONE envelope: not "did the
// second run fail" but "does this envelope contain the probes the table is
// built from". Same conclusion in both cases — refuse, and SAY why.

/**
 * The per-tool PATH probes the Dependencies table exists to report.
 *
 * MEASURED, never guessed. `west`, `zephyrSdk` and `hostPython` are read off
 * the pinned binary (`test/fixtures/tan-doctor.v0.6.0.darwin.json`);
 * `git`, `python`, `cmake`, `ninja`, `dtc`, `gperf`, `yoctoHost` and
 * `vendorToolchain` off tan v0.4.0's `--build` envelope
 * (`test/fixtures/tan-doctor-build.v0.4.0.windows.json`). Two generations of
 * vocabulary, so the predicate below is not pinned to one release's spelling.
 *
 * THREE NAMES ARE DELIBERATELY ABSENT, and each omission is what lets the
 * predicate fire at all — every one of them IS emitted by the gutted envelope:
 *
 *  - `hostPrerequisites` is an AGGREGATE ("git, cmake, python3, ninja
 *    present"), not a per-tool row. It is exactly the row that renders `fail`
 *    with no button on the gutted envelope, so treating it as proof the probes
 *    arrived would green-light the defect this guard is for.
 *  - `westResolved` asks whether west resolves inside the WORKSPACE VENV —
 *    the same PATH-vs-venv distinction `LEGACY_PROJECT_CHECKS` draws and the
 *    version cell already refuses to blur.
 *  - `zephyrSdkHost` / `zephyrSdkAvailableForHost` asks whether the Zephyr SDK
 *    PUBLISHES a build for this host. That is a fact about upstream, not about
 *    anything installed on this machine.
 */
const TOOLCHAIN_PROBE_CHECKS: ReadonlySet<string> = new Set([
  "cmake",
  "dtc",
  "git",
  "gperf",
  "hostPython",
  "ninja",
  "python",
  "vendorToolchain",
  "west",
  "yoctoHost",
  "zephyrSdk",
]);

/**
 * Whether this envelope carries ANY of the per-tool probes above.
 *
 * ANY — not all of them, and not a count. tan renames checks (`zephyrSdkHost`
 * → `zephyrSdkAvailableForHost` between v0.4.0 and 0.5.1) and adds them, so
 * demanding a particular set would refuse a perfectly good future envelope,
 * and a table blanked by a false refusal is the same damage as a table gutted
 * by a false pass. What is detected is the one measured shape: an envelope
 * with NO per-tool probe whatsoever.
 *
 * DETECTED FROM CONTENT, NOT FROM A VERSION STRING. `alpSdk.cliPath` points
 * anywhere, `--version` can fail to parse or be a fork's own numbering, and a
 * modern tan that regressed its check list is just as unusable here as an old
 * one. A version ALSO cannot be the second half of an AND (a mislabelled
 * binary would pass) or of an OR (a good envelope from an odd version string
 * would be refused). It is used below for exactly one thing: making the
 * refusal SENTENCE concrete, where being wrong costs a less specific
 * explanation and nothing else.
 *
 * Pure — exported for the test.
 */
export function carriesToolchainProbes(data: DoctorEnvelopeData): boolean {
  return data.checks.some((check) => TOOLCHAIN_PROBE_CHECKS.has(check.name));
}

/**
 * The refusal sentence, naming the cause and the way out.
 *
 * `installedTan` is the version the extension already probed for its own state
 * — passed in, never re-probed, and NEVER consulted to decide. It only sharpens
 * the sentence: a binary behind the pin is the expected cause, and one that is
 * NOT behind is a stranger fact worth stating rather than hiding.
 *
 * Pure — exported for the test.
 */
export function toolchainProbesMissingError(
  installedTan: string | null,
): string {
  const observed =
    installedTan === null
      ? ""
      : isCliBehind(installedTan)
        ? ` The resolved binary reports ${installedTan}, which is behind that pin.`
        : ` The resolved binary reports ${installedTan}, which is NOT behind ` +
          "that pin — so it is claiming a version whose doctor envelope it " +
          "does not produce.";
  return (
    "This tan reported no host tool checks at all — no row for git, Python, " +
    "CMake, Ninja, west or the Zephyr SDK — so the dependency table would " +
    "show only the project rows and read as if every tool on this machine " +
    "were fine. Nothing is shown rather than that. Alp SDK pins tan " +
    `${SUPPORTED_CLI_VERSION}, which reports those checks in every ` +
    "`tan doctor` run; tan v0.4.0 reported them only under " +
    "`tan doctor --build`, a flag that does nothing at the pin " +
    `(tan-cli#290) and is not sent.${observed} Run "Alp: Reinstall the ` +
    'pinned tan CLI" from the command palette, or clear the ' +
    "`alpSdk.cliPath` setting so the managed copy is used."
  );
}

// ── Drift in tan's `scope` vocabulary ────────────────────────────────────────

/**
 * What `isProjectCheck` found in this envelope's `scope` field that it does not
 * interpret, and what it interprets that the envelope never used.
 *
 * BOTH DIRECTIONS, because the retired `test/deps.allowlistDrift.test.js`'s
 * core property was that an entry the binary does not emit is REPORTED rather
 * than silently doing nothing — and that property has an exact analogue in the
 * new vocabulary. `isProjectCheck` maps an unrecognised scope to "host", which
 * is the right default (see its own doc) and is also completely silent: rename
 * `project` upstream and every project row is answered against `os.tmpdir()`
 * with no log and no failing test. That is #472's silence, one field over.
 *
 * `unknown` is at VALUE granularity, not a boolean: which word arrived is the
 * whole content of the report, and a `true` says nothing anyone can act on.
 */
export interface ScopeVocabularyDrift {
  /** Scope values this envelope carries that `isProjectCheck` does not
   *  interpret, each with the checks that carried it. Sorted by value. */
  unknown: readonly { scope: string; checks: readonly string[] }[];
  /** Words `isProjectCheck` interprets that NO check in this envelope used. */
  unused: readonly string[];
  /** True when not one check carried a `scope` string — a pre-0.5 binary,
   *  where there is no vocabulary to compare and the two lists above are
   *  meaningless rather than empty. */
  unscoped: boolean;
}

/** The vocabulary `isProjectCheck` interprets, in full. */
const SCOPE_VOCABULARY: readonly string[] = [PROJECT_SCOPE, "host"];

/** Pure — exported for the test. */
export function scopeVocabularyDrift(
  data: DoctorEnvelopeData,
): ScopeVocabularyDrift {
  const byScope = new Map<string, string[]>();
  for (const check of data.checks) {
    const scope: string | undefined = check.scope;
    if (typeof scope !== "string") continue;
    const seen = byScope.get(scope);
    if (seen) seen.push(check.name);
    else byScope.set(scope, [check.name]);
  }
  if (byScope.size === 0) return { unknown: [], unused: [], unscoped: true };
  return {
    unknown: [...byScope.keys()]
      .filter((scope) => !SCOPE_VOCABULARY.includes(scope))
      .sort()
      .map((scope) => ({ scope, checks: byScope.get(scope) ?? [] })),
    unused: SCOPE_VOCABULARY.filter((scope) => !byScope.has(scope)),
    unscoped: false,
  };
}

/**
 * The log lines `drift` calls for — one per condition, none when there is
 * nothing to say.
 *
 * Returned rather than logged so the test can read them; the caller logs them.
 * Pure — exported for the test.
 */
export function scopeDriftLogLines(
  drift: ScopeVocabularyDrift,
): readonly string[] {
  if (drift.unscoped) {
    // #472's successor. The allowlist that could go stale is gone, but the
    // withholding decision still has a fallback path for a tan too old to
    // report `scope`, and a silent fallback is how the allowlist rotted.
    return [
      "[deps] this tan reports no `scope` on any doctor check, so whether a " +
        "row reads the project is decided by LEGACY_PROJECT_CHECKS, a hand " +
        "list derived against v0.4.0. Expected for a binary older than the " +
        `pin (${SUPPORTED_CLI_VERSION}); if this appears on the pinned tan, ` +
        "the field was renamed and the list is now the only thing deciding " +
        "— see #472.",
    ];
  }
  const lines: string[] = [];
  for (const { scope, checks } of drift.unknown) {
    lines.push(
      `[deps] tan scoped ${checks.length} doctor check(s) ` +
        `"${scope}", a word this extension does not interpret: ` +
        `${checks.join(", ")}. They are treated as HOST checks, so they are ` +
        "shown with no folder open — if any of them actually reads the " +
        "project, its verdict is about a temp directory. See #472.",
    );
  }
  for (const scope of drift.unused) {
    lines.push(
      `[deps] no doctor check in this envelope is scoped "${scope}", a word ` +
        "`isProjectCheck` still branches on. Either this run genuinely had " +
        "no such check, or the word was renamed upstream and the branch is " +
        "now dead — the withholding decision is being made on a vocabulary " +
        `the binary no longer uses. Pin: ${SUPPORTED_CLI_VERSION}.`,
    );
  }
  return lines;
}

/**
 * The log line `buildDependencyReport` raises when
 * `DependencyReport.orphanedPrerequisites` is non-empty (#603) — a
 * prerequisite tan named a real command for that bound to no row at all,
 * because the `hostPrerequisites` check that carries every leftover entry is
 * not in this envelope (renamed, or removed). Names every tool AND its
 * command, so the "Alp SDK" channel says exactly what silently stopped
 * reaching a button, not just that something did.
 *
 * Empty when there is nothing to say. Returned rather than logged directly so
 * the test can read it; the caller logs it. Pure — exported for the test.
 */
export function orphanedPrerequisiteLogLines(
  orphaned: readonly MissingPrerequisite[],
): readonly string[] {
  if (orphaned.length === 0) return [];
  return [
    `[deps] tan reported ${orphaned.length} prerequisite(s) with a real ` +
      "install command that bound to NO row in the dependency table " +
      `(${orphaned.map((p) => `${p.tool}: ${p.command}`).join("; ")}) — the ` +
      '"hostPrerequisites" check this extension expects to carry every ' +
      "leftover prerequisite is not in this envelope. Filed as an issue " +
      "against tan-cli if this appears on the pinned binary. See #603.",
  ];
}

/**
 * Once per extension-host session, not once per refresh (#603, second
 * review, minor 8) — the same one-shot shape `DependencyPanel`'s own
 * `offeredBootstrap` uses. `refresh()` re-derives on EVERY window focus
 * (`src/extension.ts`'s `onDidChangeWindowState`), and a genuinely orphaned
 * envelope stays orphaned across every one of those — an unthrottled
 * warn-level 60-word paragraph on every alt-tab back into the editor trains
 * a reader to skim past the "Alp SDK" channel, which loses the invariant as
 * surely as no line at all would.
 */
let orphanedPrerequisitesLogged = false;

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
// leaves NO table at all: `doctor.data` is null, so `buildDependencyReport`
// returns `report: null` and the panel shows its inline error text instead.

// ── The report ───────────────────────────────────────────────────────────────

export interface DependencyReportResult {
  /** `null` when `tan doctor` produced no usable envelope. */
  report: DependencyReport | null;
  /** Customer-facing sentence for that empty state, shown INLINE by the panel.
   *  The raw stderr / exit code was already logged by `runAlpCommand`. */
  error?: string;
}

/**
 * Build the dependency report: ONE `tan doctor` run, fed to the pure planner,
 * plus the host-known cells.
 *
 * ONE SPAWN. It was two (#544) — plain `doctor` and `doctor --build`, run
 * concurrently — because on tan v0.4.0 the flag genuinely changed the check
 * list and `--build` alone had no row for `longPaths`, which is a build that
 * dies in CMake on a stock Windows install. At SUPPORTED_CLI_VERSION `--build`
 * is a documented no-op (tan-cli#290) and the two envelopes are identical, so
 * the second run was a subprocess per refresh for a byte-for-byte duplicate.
 *
 * `["doctor"]` is the one kept, not `["doctor", "--build"]`: passing a flag
 * that does nothing invites the reader to believe it does something.
 *
 * NO FOLDER OPEN is not a refusal. The old refusal closed a cycle a customer
 * following the published walkthrough could not break: the prerequisite table
 * needed a folder, the folder needed the SDK, the SDK needed git, and git was
 * installed from the prerequisite table. Host-tool checks are host facts, so
 * they run with no folder; the checks that read the project are withheld and
 * SAY they were withheld (`withheldProjectChecks`), because a project check
 * answered against no project — "board.yaml not found" about a directory the
 * customer never chose — is worse than the refusal was.
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
  //
  // `readOnlyProjectCwd()` for the VALUE — the one place that fallback is
  // spelled, shared with the two `sdk list` sites (#605) — but `hasProject`
  // still needs `project.workspaceRoot` itself: the helper only returns the
  // resolved directory, not whether it had to fall back to get there, and
  // `withheldProjectChecks` below needs that boolean, not the path.
  const hasProject = project.workspaceRoot !== null;
  const cwd = readOnlyProjectCwd();
  const interactive = options.interactive === true;
  const doctor = await runDoctor(
    context,
    ["doctor"],
    cwd,
    options.signal,
    interactive,
  );
  if (!doctor.data) {
    // The whole table came from this one run, so losing it is losing the
    // table. A partial table that looked complete would be the worse answer.
    return { report: null, error: doctor.message };
  }
  // An envelope with no per-tool probe in it is the same loss by a different
  // route: every row the table exists for is simply absent, and what is left
  // looks like a complete, mostly-passing report. Refuse it, and say why —
  // see `carriesToolchainProbes` for what is detected and why not on version.
  if (!carriesToolchainProbes(doctor.data)) {
    const error = toolchainProbesMissingError(state.setup.toolVersions.tan);
    log(`[deps] ${error}`);
    return { report: null, error };
  }
  for (const line of scopeDriftLogLines(scopeVocabularyDrift(doctor.data))) {
    log(line);
  }
  const data = withheldProjectChecks(doctor.data, hasProject);

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
  // #603: the orphan invariant is only real if a rename is ever SEEN. Without
  // this line `orphanedPrerequisites` is written and read by nothing outside
  // the type itself — the next `hostPrerequisites` rename would be exactly as
  // silent to a customer as the bug this report exists to catch.
  if (
    planned.orphanedPrerequisites.length > 0 &&
    !orphanedPrerequisitesLogged
  ) {
    orphanedPrerequisitesLogged = true;
    for (const line of orphanedPrerequisiteLogLines(
      planned.orphanedPrerequisites,
    )) {
      log(line, "warn");
    }
  }

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

/** One `command` action step's dispatch result. `code: undefined` means the
 *  task never started or its exit code could not be read — never a success. */
export interface CommandStepOutcome {
  tool: string;
  command: string;
  code: number | undefined;
}

/**
 * Run one row's action. The caller resolved it by ROW ID against the report it
 * last posted, so neither a command string, the fix id, nor `rowName` is ever
 * taken from the webview — they all came out of tan's own envelope.
 *
 * An options object, not positional parameters: `rowName` and `cwd` are both
 * plain strings, so swapping them at a call site type-checks silently — a
 * shape only a test that actually asserts on `cwd` would catch, and the
 * winget test that predates this signature did not.
 *
 * `sevenZipStatus` is tan's own `sevenZip` check row's status (undefined when
 * that envelope carried no such row) — read only by the `zephyrSdk` branch's
 * post-install notice, and never re-probed here: tan owns that fact.
 *
 * Returns the per-step outcomes for a `command` row, or `undefined` for
 * `fix`/`zephyrSdk` rows — those are always a single fire-and-forget terminal
 * launch with no sequence to report on.
 *
 * THE HARD CONTRACT (#603): for a `command` row, THIS is the one place that
 * owns `awaitRun(INSTALL_RUN_NAME)`. `runFixAll` calls this function directly
 * and awaits its promise rather than keeping a second `awaitRun` of its own —
 * two owners would let step 1's finish be read as the WHOLE row's finish,
 * advancing to the next row (or the next STEP) while an earlier one is still
 * running, or dropping steps 2..N outright, since `runInTerminal` refuses a
 * same-named run that is still active. That is exactly how the reverted #600
 * attempt would have failed even after fixing its `&&` join.
 */
export async function runDependencyAction(options: {
  action: DependencyAction;
  rowName: string;
  cwd: string | undefined;
  sevenZipStatus: DependencyStatus | undefined;
  /** Checked BETWEEN steps, never mid-step — `runFixAll`'s own cancellation
   *  token, so Fix-all's Cancel stops a multi-step row the same way it stops
   *  the row-to-row loop: no FURTHER step, never one already in flight
   *  (#146). `undefined` for every other caller — a single row's own button
   *  has no cancel UI. */
  token?: vscode.CancellationToken;
}): Promise<CommandStepOutcome[] | undefined> {
  const { action, rowName, cwd, sevenZipStatus, token } = options;
  if (action.kind === "fix") {
    runToolchainFix(action.fixId);
    return undefined;
  }
  if (rowName === ZEPHYR_SDK_CHECK_NAME) {
    // Always exactly one step: only a per-tool MATCH can bind an action to
    // this row (`planDependencyReport`'s pass 1) — the rollup pass never
    // claims a check that already has its own dedicated row.
    runZephyrSdkInstall(action.commands[0].command, sevenZipStatus);
    return undefined;
  }

  // The plain `command` path: one dispatch per step, in order, waiting for
  // each to finish before the next is even attempted. NEVER joined with `&&`
  // (breaks Windows PowerShell 5.1 — #600) or `;` (runs a later step after an
  // earlier one failed and collapses two exit codes into one).
  const outcomes: CommandStepOutcome[] = [];
  let dispatchedAny = false;
  for (const step of action.commands) {
    if (token?.isCancellationRequested) break;
    if (isRunActive(INSTALL_RUN_NAME)) {
      // A collision with an already-running install under this same name —
      // either a second press on THIS (or another) row while one is still
      // going, or a race for the slot AFTER this row's own earlier step
      // finished. `runInTerminal` itself is what refuses and tells the
      // customer why (the same "is still running — wait for it to finish"
      // warning + Show Terminal offer it has always shown), so it is called
      // here too rather than silently breaking — a silent stop is worse than
      // the bug this replaces (a customer who answers the consent screen and
      // gets no feedback at all). Not awaited: a refused dispatch reserves
      // nothing and fires nothing (see `awaitRun`'s own doc), so subscribing
      // here would hang the whole row forever.
      runInTerminal({ name: INSTALL_RUN_NAME, command: step.command, cwd });
      log(
        `[deps] "${INSTALL_RUN_NAME}" is already running — "${step.command}" was not dispatched`,
        "warn",
      );
      break;
    }
    // Subscribed BEFORE the dispatch — see `awaitRun`'s own doc: a fast
    // install can finish before a promise created afterwards ever attaches.
    const finished = awaitRun(INSTALL_RUN_NAME);
    // tan's own command line, run VERBATIM in its own terminal dispatch.
    runInTerminal({ name: INSTALL_RUN_NAME, command: step.command, cwd });
    // Raised once, after the FIRST step actually dispatches — never before a
    // press that turned out to dispatch nothing (the `isRunActive` refusal
    // above). Raising it unconditionally up front meant a refused press
    // still fired this notice, whose `dedupeKey` then suppressed the
    // ALREADY-showing notice from the press that is actually running,
    // leaving the customer with neither.
    if (!dispatchedAny) {
      dispatchedAny = true;
      offerReloadAfterInstall();
    }
    const code = await finished;
    outcomes.push({ tool: step.tool, command: step.command, code });
    if (code !== 0) break;
  }
  return outcomes;
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
  /**
   * Rows whose run exited non-zero, each with the code.
   *
   * `completed` / `failedCommand` / `notRun` are the multi-step half (#603): a
   * `command` row that installs cmake then fails on ninja already changed the
   * machine, and a bare `{name, code}` implies otherwise. Empty / `undefined`
   * for a `fix`/`bootstrap` row, which is always a single dispatch with no
   * sub-steps to enumerate — `describeFixAllFailure` reads exactly that to
   * keep those rows worded the way they always were.
   */
  failed: {
    name: string;
    code: number | undefined;
    /** Tool names from THIS row whose step already succeeded. */
    completed: string[];
    /** The exact command that failed, verbatim — `undefined` for a
     *  `fix`/`bootstrap` row, which has no command string to show. */
    failedCommand: string | undefined;
    /** Tool names from this row whose step never ran because an earlier one
     *  in the SAME row failed first. */
    notRun: string[];
  }[];
  /** Rows never started, because the user cancelled or a run was already
   *  holding the slot. Reported, never silently dropped. */
  skipped: {
    name: string;
    reason: string;
    /**
     * Tool names from THIS row that already installed before the row was cut
     * short (cancelled between steps, or a run-name race after step 1) —
     * `undefined`/empty for every skip that never started at all (declined
     * consent, unchecked, `"<name>" is already running`, cancelled before
     * this row's own turn). The SAME honesty `failed.completed` exists for:
     * a 2-step row that installs cmake and is then cancelled before ninja is
     * NOT "0 installed" — cmake is on the machine — and `skipped` must not
     * say otherwise just because the row's own outcome landed here instead
     * of in `failed` (#603).
     */
    completed?: string[];
  }[];
}

/**
 * One `skipped` entry, worded for the summary toast (`deps/panel.ts`) —
 * `describeFixAllFailure`'s sibling. A skip with no `completed` keeps the
 * ORIGINAL `"<name>: <reason>"` wording, unchanged.
 */
export function describeFixAllSkip(
  entry: FixAllOutcome["skipped"][number],
): string {
  if (!entry.completed || entry.completed.length === 0) {
    return `${entry.name}: ${entry.reason}`;
  }
  return `${entry.name}: ${entry.reason} (installed ${entry.completed.join(", ")} first)`;
}

/**
 * Appends what a cancelled/raced-away row already installed to a Fix-all
 * summary sentence — the CUSTOMER-VISIBLE half, not `detail`.
 *
 * `planSuccess`'s status-bar channel (no `actions`, the plain case here)
 * shows ONLY its `message` string; `detail` is written to the "Alp SDK"
 * channel and never reaches the customer at all (`src/notify/vscodeAdapter.ts`
 * — "the ONLY place `detail` is ever written"). A 2-step row that installs
 * cmake and is then cancelled before ninja is never in `outcome.installed`
 * (the ROW did not finish), but `outcome.skipped[].completed` says cmake IS
 * on the machine — and that fact belongs in `base` (destined for `message` /
 * `cause`), not folded into `parts.join(" · ")` (destined for `detail`),
 * or it never reaches the customer who just watched the consent screen and
 * pressed the button (#603).
 *
 * `base` unchanged when nothing completed outside `outcome.installed` — the
 * ordinary case, where the existing sentence already says everything.
 */
export function withFixAllPartialNote(
  base: string,
  outcome: Pick<FixAllOutcome, "skipped">,
): string {
  const partial = outcome.skipped.flatMap((entry) => entry.completed ?? []);
  if (partial.length === 0) return base;
  return `${base} ${partial.join(", ")} installed before stopping.`;
}

/**
 * One `failed` entry, worded for the summary toast (`deps/panel.ts`).
 *
 * A `fix`/`bootstrap` row (no `failedCommand`) keeps the ORIGINAL wording —
 * `"<name> exit <code>"` — unchanged, so this is additive rather than a
 * rewrite of an existing, already-correct sentence. A multi-step `command` row
 * says what actually happened on the machine: what installed, what failed
 * with which code, and that nothing after it ran (#603 design item 6).
 */
export function describeFixAllFailure(
  entry: FixAllOutcome["failed"][number],
): string {
  if (entry.failedCommand === undefined) {
    return `${entry.name} exit ${entry.code ?? "unknown"}`;
  }
  const parts: string[] = [];
  if (entry.completed.length > 0) {
    parts.push(`installed ${entry.completed.join(", ")}`);
  }
  parts.push(`\`${entry.failedCommand}\` exited ${entry.code ?? "unknown"}`);
  parts.push(
    entry.notRun.length > 0
      ? `nothing after it ran (${entry.notRun.join(", ")} skipped)`
      : "nothing after it ran",
  );
  return `${entry.name}: ${parts.join("; ")}`;
}

/**
 * What a single row's OWN multi-step dispatch means for the customer, or
 * `null` when there is nothing NEW to say — every step ran and succeeded (the
 * generic "press Refresh" reload notice already covers it), or nothing ran at
 * all (the per-step `isRunActive` refusal already showed its own warning).
 *
 * The "stopped short with nothing erroring" case (a single-row press has no
 * cancel UI, so this is a run-name race mid-row) is NOT silent (#603, second
 * review, minor 9): `offerReloadAfterInstall`'s generic reload prose blames
 * "tan may have reported no install command for one of them", which is
 * simply the wrong cause here — nothing about a missing command caused this,
 * a later step was refused. Worded as a SKIP (`severity: "warning"`, but the
 * sentence itself never uses "exited" or "failed"), not folded into the
 * `describeFixAllFailure` failure wording, which is reserved for a step that
 * actually returned a non-zero code.
 *
 * PURE, and exported specifically so the WORDING DECISION can be tested with
 * VALUES rather than only through a source-level regex on the caller
 * (`deps/panel.ts`'s `reportRowStepFailure`) — a regex that matches
 * `describeFixAllFailure(`/`notifyAsync(`/`planFailure(` verbatim survives a
 * same-shape mutation of the `find` predicate untouched (#603, second
 * review, blocker 2): `find((step) => step.code !== 0)` mutated to
 * `=== 0` still contains every one of those tokens, so nothing textual
 * catches it, while a value-based test over THIS function's return catches it
 * directly.
 *
 * The failure branch reuses `describeFixAllFailure`'s wording — a row button
 * and a Fix-all report the SAME failure the SAME way.
 */
export function rowStepFailureNotice(
  rowName: string,
  commands: readonly DependencyCommandStep[],
  steps: readonly CommandStepOutcome[],
): { cause: string; dedupeKey: string; severity: "warning" } | null {
  if (steps.length === 0) return null;
  if (
    steps.length === commands.length &&
    steps.every((step) => step.code === 0)
  ) {
    return null;
  }
  const failedStep = steps.find((step) => step.code !== 0);
  if (!failedStep) {
    // Stopped short, but nothing returned a non-zero code — a run-name race
    // mid-row, not a failed command. Say what completed and what never ran,
    // never "exited"/"failed".
    const completed = steps.map((step) => step.tool);
    const notRun = commands.slice(steps.length).map((step) => step.tool);
    return {
      cause:
        `${rowName}: installed ${completed.join(", ")}; ` +
        `${notRun.join(", ")} was not attempted — press Refresh, then try again`,
      dedupeKey: `deps-row-skipped-${rowName}`,
      severity: "warning",
    };
  }
  return {
    cause: describeFixAllFailure({
      name: rowName,
      code: failedStep.code,
      completed: steps
        .filter((step) => step.code === 0)
        .map((step) => step.tool),
      failedCommand: failedStep.command,
      notRun: commands.slice(steps.length).map((step) => step.tool),
    }),
    dedupeKey: `deps-row-failed-${rowName}`,
    severity: "warning",
  };
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

/** One consent line: artifact on the label, ADR 0021 §3's four facts under it,
 *  plus — for a partial `command` row only — a fifth clause naming what tan
 *  named no install command for (#603, second review, nit 10: this line
 *  drifted stale once `minor 7` added that fifth clause; the inline comment
 *  on `detail` below is the one that stays current). */
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
    // Every line, verbatim, in dispatch order — a multi-step `command` row
    // (#603) names EVERY command it will run, never just the first. The " ; "
    // join is DISPLAY TEXT for this QuickPick row only; it is never the string
    // that reaches a shell (`runDependencyAction` dispatches each line as its
    // own `runInTerminal` call — see that function's own doc for why joining
    // the DISPATCH would be wrong).
    //
    // `item.omittedTools` (#603, second review, minor 7) — NOT `item.title` —
    // closes the consent screen out for a PARTIAL row: a short clause built
    // here, appended only when non-empty. Appending the whole `title` sentence
    // unconditionally was tried first and reverted: a non-partial row
    // duplicated `Runs:` under a second separator, and a `fix`/`open-docs`/
    // `bootstrap` row (always `omittedTools: []`) got a second, competing
    // claim about what the button does.
    detail:
      `Runs: ${item.source ? item.source.join(" ; ") : NOT_REPORTED} · ` +
      `Size: ${item.size ?? NOT_REPORTED} · ` +
      `Licence: ${item.licence ?? NOT_REPORTED}` +
      (item.omittedTools.length > 0
        ? ` · tan reported no install command for ${item.omittedTools.join(", ")}`
        : ""),
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
    // Narrowed by `fixAllTargets` — a `will-install` row always has one.
    const action = row.action as DependencyAction;

    if (action.kind === "command" && row.name !== ZEPHYR_SDK_CHECK_NAME) {
      if (action.commands.length === 0) {
        // `DependencyAction`'s own doc says `commands` is never empty — this
        // is that invariant breaking, not an ordinary outcome. Never treated
        // as success: `steps.length === action.commands.length` below is
        // `0 === 0`, and `[].every(...)` is vacuously true, so without this
        // guard an empty list would report INSTALLED for a row that
        // dispatched nothing at all.
        log(
          `[fix-all] ${row.name}: a command row reached runFixAll with an EMPTY commands[] — the planner's invariant broke`,
          "error",
        );
        outcome.skipped.push({
          name: row.name,
          reason: "no command to run",
        });
        continue;
      }
      // THE HARD CONTRACT (#603): `runDependencyAction` owns `awaitRun` for
      // this run name itself — see its own doc. This is the one branch that
      // must NOT also subscribe `awaitRun(runName)` here; doing so would let
      // step 1's finish be read as this whole row's finish and advance past
      // steps 2..N while they are still running.
      const steps =
        (await runDependencyAction({
          action,
          rowName: row.name,
          cwd,
          sevenZipStatus: sevenZip?.status,
          token,
        })) ?? [];
      log(
        `[fix-all] ${row.name}: ${steps.length}/${action.commands.length} step(s) ran`,
      );

      if (
        steps.length === action.commands.length &&
        steps.every((s) => s.code === 0)
      ) {
        outcome.installed.push(row.name);
        continue;
      }
      if (steps.length === 0) {
        // Nothing even started — a race for `runName` after this row's own
        // turn began (the pre-dispatch `isRunActive` check above only rules
        // out a collision BEFORE step 1). Not a failure: nothing on the
        // machine changed for this row, so the sequence continues rather
        // than aborting the rows after it.
        outcome.skipped.push({
          name: row.name,
          reason: `"${runName}" is already running`,
        });
        continue;
      }
      if (steps.every((s) => s.code === 0)) {
        // Every step that ran succeeded, but the row stopped short of the
        // full list — cancellation between steps, or the same race as above
        // arriving after step 1. Nothing errored, so this is a skip, not a
        // failure, and the loop's own top-of-iteration cancellation check
        // marks every row after it the same way on its own turn.
        //
        // `completed` carries what DID install: a "cancelled" skip with no
        // completed list reads as "nothing happened", which is false the
        // moment step 1 of 2 already succeeded — the same dishonesty
        // `failed.completed` exists to close, one branch over.
        outcome.skipped.push({
          name: row.name,
          reason: token.isCancellationRequested
            ? "cancelled"
            : `"${runName}" became active mid-row`,
          completed: steps.map((s) => s.tool),
        });
        continue;
      }

      const failedStep = steps.find((s) => s.code !== 0);
      outcome.failed.push({
        name: row.name,
        code: failedStep?.code,
        completed: steps.filter((s) => s.code === 0).map((s) => s.tool),
        failedCommand: failedStep?.command,
        notRun: action.commands.slice(steps.length).map((s) => s.tool),
      });
      for (const rest of targets.slice(index + 1)) {
        outcome.skipped.push({
          name: rest.name,
          reason: `stopped after ${row.name} failed`,
        });
      }
      break;
    }

    // `fix` / `bootstrap` rows, and the `zephyrSdk` special case: a single
    // fire-and-forget terminal launch, unchanged from before #603 — this is
    // the path `runNameFor`'s own doc calls out as staying on the existing
    // `awaitRun` + dispatch pattern.
    // Subscribed BEFORE the dispatch: a fast install can finish before a
    // promise created afterwards ever attaches.
    const finished = awaitRun(runName);
    void runDependencyAction({
      action,
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
    outcome.failed.push({
      name: row.name,
      code,
      completed: [],
      failedCommand: undefined,
      notRun: [],
    });
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

/**
 * The one remaining single-shot terminal dispatch — reached only from
 * `runZephyrSdkInstall`'s "not actually a plain `west …` command" fallback,
 * where `retargetWestCommand` refused to retarget the line and the ordinary
 * shell dispatch is what is left.
 *
 * Guarded the SAME way `runZephyrSdkInstall`'s own dispatch just above
 * already is (and the generic per-step loop in `runDependencyAction` is):
 * `runInTerminal` may refuse a concurrent press under this name — in which
 * case it already told the customer why, and raising
 * `offerReloadAfterInstall` on top would read as though a NEW install just
 * started over a dispatch that never happened.
 *
 * THIS WAS MISSED THE FIRST TIME (#603, second review, major 5): the
 * unconditional-`runInTerminal`-then-notice shape is the exact defect fixed
 * in `runDependencyAction`'s per-step loop one review round earlier, and it
 * survived here, unfixed, because that fix was scoped to a prose finding
 * list rather than grepped for by SHAPE across the file. Lesson kept for the
 * next reader: when a finding names a defect shape, grep the shape, not the
 * one call site the finding happened to measure.
 */
function runInNewTerminal(command: string, cwd: string | undefined): void {
  const alreadyRunning = isRunActive(INSTALL_RUN_NAME);
  runInTerminal({ name: INSTALL_RUN_NAME, command, cwd });
  if (!alreadyRunning) offerReloadAfterInstall();
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
        "reload does not pick up a new PATH. If this row covers more than one " +
        "tool, tan may have reported no install command for one of them — see " +
        "the row's hint and this button's tooltip for what this press does " +
        "not cover; the row can stay failing even after a clean install of " +
        "everything it did.",
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
