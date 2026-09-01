// SPDX-License-Identifier: Apache-2.0
//
// Every host with a published tan asset is EXECUTED somewhere in CI (#446).
//
// ── The debt this closes ────────────────────────────────────────────────────
//
// #446's last open item was per-platform verification before a stable cut:
// `win32/x64`, `darwin/x64` and `linux/x64` each have a published asset and no
// CI execution, so they needed "a manual pass". A manual pass answers the
// question once, for one pin. The pin moves, and the answer silently stops
// applying — `SUPPORTED_CLI_VERSION` has gone 0.4.0 → 0.5.0-rc1 → 0.5.1 →
// 0.6.0 while that item stayed open.
//
// So the coverage is a CI matrix instead, and this file is what stops the
// matrix from rotting.
//
// ── Why derive rather than list ─────────────────────────────────────────────
//
// A hand-written list of hosts would pass this file by agreeing with itself.
// The #639 measurement is the reason that is not acceptable: deleting an entry
// from a hand-written table left the whole gate GREEN, because shrinking an
// allowlist is invisible to a test that reads the allowlist.
//
// The required set is therefore RECOMPUTED here from the same two constants
// the downloader itself uses — `TARGETS` (every host tuple tan publishes for)
// minus `HOSTS_WITHOUT_RELEASE_ASSET[SUPPORTED_CLI_VERSION]` (the hosts this
// specific pin declares no asset for). Adding a host to `TARGETS`, or removing
// a declared gap because tan started publishing it, makes this file fail until
// a runner is added — which is the direction that actually hurts.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const root = path.join(__dirname, "..");

const { TARGETS, HOSTS_WITHOUT_RELEASE_ASSET, SUPPORTED_CLI_VERSION } = require(
  path.join(root, "out", "alpCli", "service.js"),
);

const CI_WORKFLOW = path.join(root, ".github", "workflows", "ci.yml");
const JOB = "verify_pinned_cli_hosts";

const workflow = yaml.load(fs.readFileSync(CI_WORKFLOW, "utf-8"));

/**
 * Hosts that HAVE a published asset but have no runner to execute it on.
 *
 * This is the one place a host is allowed to go unverified, and it is not a
 * convenience list — every entry is a standing hole of exactly the kind #446
 * was opened about. The difference from before is that the hole is asserted:
 * the entry carries its reason, and the size assertion below refuses to let
 * this grow quietly.
 *
 * `darwin/x64`: `macos-13` was the last standard-rate Intel macOS image and is
 * RETIRED — unsupported since 2025-12-04 and absent from
 * `actions/runner-images`' README table. Measured rather than assumed: a
 * `macos-13` job on this repo sat QUEUED with no runner assigned while
 * ubuntu-latest, windows-latest and macos-latest each picked one up in seconds.
 * Every remaining x64 macOS label (`macos-15-intel`, `macos-15-large`,
 * `macos-26-intel`, `macos-26-large`) is a LARGER runner, billed even on a
 * public repo. Bare `macos-15`/`macos-26` are arm64, as is `macos-latest`.
 *
 * DELETE the entry the day a standard-rate Intel image exists.
 */
const NO_RUNNER_AVAILABLE = Object.freeze({
  "darwin/x64":
    "macos-13 is retired; every remaining x64 macOS label is a billed larger runner",
});

/** The hosts this pin actually publishes an asset for. */
function hostsWithAnAsset() {
  const declaredGaps = new Set(
    HOSTS_WITHOUT_RELEASE_ASSET[SUPPORTED_CLI_VERSION] ?? [],
  );
  return Object.keys(TARGETS).filter((host) => !declaredGaps.has(host));
}

/** Hosts that must actually be executed: published, and runnable somewhere. */
function hostsRequiringExecution() {
  return hostsWithAnAsset().filter(
    (host) => !Object.prototype.hasOwnProperty.call(NO_RUNNER_AVAILABLE, host),
  );
}

/** The `platform/arch` tuples the verification job runs, from its own matrix. */
function hostsCoveredByCi() {
  const job = workflow?.jobs?.[JOB];
  assert.ok(
    job,
    `.github/workflows/ci.yml no longer defines a \`${JOB}\` job. If the ` +
      `verification moved, point this test at its new home — do not delete ` +
      `it: #446's per-platform coverage is the thing it protects.`,
  );
  const include = job.strategy?.matrix?.include ?? [];
  return include.map((entry) => `${entry.platform}/${entry.arch}`);
}

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

test("every host with a published asset AND a runner is executed by CI", () => {
  const required = hostsRequiringExecution();
  const covered = new Set(hostsCoveredByCi());

  const missing = required.filter((host) => !covered.has(host));
  assert.deepEqual(
    missing,
    [],
    `these hosts have a published tan asset at the ${SUPPORTED_CLI_VERSION} ` +
      `pin and nothing in CI ever runs it: ${missing.join(", ")}. Either add ` +
      `a matrix entry to \`${JOB}\` (ubuntu-latest / windows-latest / ` +
      `macos-latest cover linux/x64, win32/x64 and darwin/arm64), or, if tan ` +
      `genuinely stopped publishing for the host, declare it in ` +
      `HOSTS_WITHOUT_RELEASE_ASSET. Shipping a CLI nobody has ever executed ` +
      `on the host it targets is what #446 was open on.`,
  );
});

test("the no-runner exemption stays exactly one host, with its reason", () => {
  const exempt = Object.keys(NO_RUNNER_AVAILABLE);
  assert.deepEqual(
    exempt,
    ["darwin/x64"],
    "the exemption list is the one place a published host may go unexecuted, " +
      "so it must not grow by habit. A new entry needs the same standard the " +
      "existing one met: a MEASURED absence of any runner, not an inconvenience.",
  );
  for (const [host, reason] of Object.entries(NO_RUNNER_AVAILABLE)) {
    assert.ok(
      reason.trim().length > 20,
      `${host} is exempt with no substantive reason recorded — an exemption ` +
        `whose justification is not written down is indistinguishable from an ` +
        `oversight the next reader will preserve`,
    );
  }
});

test("an exempt host is genuinely published — otherwise it belongs in the gaps table", () => {
  const published = new Set(hostsWithAnAsset());
  for (const host of Object.keys(NO_RUNNER_AVAILABLE)) {
    assert.ok(
      published.has(host),
      `${host} is exempted from EXECUTION but the pin publishes no asset for ` +
        `it either. Two different facts: "no asset" belongs in ` +
        `HOSTS_WITHOUT_RELEASE_ASSET, "asset but no runner" belongs here. ` +
        `Recording it in the wrong one hides a missing upload behind a runner ` +
        `excuse.`,
    );
  }
});

test("CI does not claim a host the pin publishes nothing for", () => {
  const required = new Set(hostsWithAnAsset());
  const spurious = hostsCoveredByCi().filter((host) => !required.has(host));
  assert.deepEqual(
    spurious,
    [],
    `\`${JOB}\` runs for ${spurious.join(", ")}, which ` +
      `HOSTS_WITHOUT_RELEASE_ASSET declares has no asset at ` +
      `${SUPPORTED_CLI_VERSION}. The staging script would exit 2 for it, and ` +
      `this job treats exit 2 as fatal — so that host would red on every PR ` +
      `for a state the pin already declares expected. Drop the matrix entry, ` +
      `or drop the declared gap if it is the stale one.`,
  );
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the derived requirement is non-empty and the matrix is real", () => {
  assert.ok(
    hostsWithAnAsset().length >= 4,
    "fewer than four hosts have an asset, which would make the coverage " +
      "assertion trivially satisfiable — TARGETS or HOSTS_WITHOUT_RELEASE_ASSET " +
      "has moved and this file's premise needs re-reading",
  );
  assert.ok(
    hostsRequiringExecution().length >= 3,
    "fewer than three hosts require execution, so the coverage assertion " +
      "would be nearly vacuous — most likely the exemption list grew",
  );
  assert.ok(
    hostsCoveredByCi().length >= 3,
    "the matrix parsed to fewer than three entries, so the assertions above " +
      "would be comparing against an almost-empty set",
  );
});

test("each matrix entry names the launcher its host actually produces", () => {
  const job = workflow.jobs[JOB];
  for (const entry of job.strategy.matrix.include) {
    const expected = entry.platform === "win32" ? "tan.exe" : "tan";
    assert.equal(
      entry.launcher,
      expected,
      `${entry.platform}/${entry.arch} declares launcher '${entry.launcher}'. ` +
        `\`binaryName\` in src/alpCli/service.ts produces '${expected}', and ` +
        `the step invokes the launcher by this name — a wrong one turns a real ` +
        `execution check into a "no such file" failure that reads like a bad ` +
        `download.`,
    );
  }
});

test("the verification job resolves the pin with the prerelease-capable pattern", () => {
  // test/cliPin.prerelease.test.js already asserts every occurrence in this
  // file accepts a prerelease. This asserts the new job HAS one, so the staging
  // call cannot quietly stop resolving the pin.
  const job = workflow.jobs[JOB];
  const resolver = job.steps.find((step) => step.id === "cli_version");
  assert.ok(
    resolver,
    `\`${JOB}\` has no \`cli_version\` step. The staging call would then have ` +
      `no --version, and \`releaseAssetForTarget\` would fall back to its ` +
      `default parameter — the COMPILED SUPPORTED_CLI_VERSION. That is not ` +
      `"the latest release", but it does silently decouple this job from the ` +
      `grep, so a workflow editing mistake stops being visible.`,
  );
  assert.match(resolver.run, /SUPPORTED_CLI_VERSION = "\[0-9\]/);
});

// ---------------------------------------------------------------------------
// The verification still RUNS
//
// Everything above asserts the host SET. None of it asserts that anything is
// still executed for those hosts, and that gap is the #639 lesson one level
// up: six ways to neuter this job — deleting the staging step, `if: false` on
// the step or the job, `continue-on-error: true`, replacing the version
// comparison with one that always matches, or hardcoding a `--version` — all
// leave the matrix untouched and every assertion above green.
// ---------------------------------------------------------------------------

const STAGING_SCRIPT = "scripts/stage-tan-cli-asset.mjs";

/** The step that does the work, or `undefined`. */
function stagingStep() {
  return (workflow.jobs[JOB].steps ?? []).find(
    (step) => typeof step.run === "string" && step.run.includes(STAGING_SCRIPT),
  );
}

test("the job still has a step that stages and runs the binary", () => {
  assert.ok(
    stagingStep(),
    `no step in \`${JOB}\` invokes ${STAGING_SCRIPT}. The matrix can be ` +
      `perfectly correct and this job verify nothing — which is exactly what ` +
      `the host-set assertions above cannot see.`,
  );
});

test("nothing can switch the verification off while leaving the matrix intact", () => {
  const job = workflow.jobs[JOB];
  const step = stagingStep();

  assert.equal(
    job.if,
    undefined,
    `\`${JOB}\` carries a job-level \`if:\`. A condition here can make every ` +
      `host skip while the checks list still shows the job — a green check ` +
      `that ran nothing.`,
  );
  assert.equal(
    step.if,
    undefined,
    `the staging step carries an \`if:\`. Same failure, one level down: the ` +
      `job runs, the step is skipped, the check is green.`,
  );
  assert.notEqual(
    step["continue-on-error"],
    true,
    `the staging step is \`continue-on-error: true\`, so a host that cannot ` +
      `run the pinned binary reports success anyway. If a host is genuinely ` +
      `unverifiable it belongs in NO_RUNNER_AVAILABLE with a reason, not ` +
      `behind a swallowed failure.`,
  );
  assert.notEqual(
    job["continue-on-error"],
    true,
    "the job is `continue-on-error: true`, which makes every failure advisory " +
      "at the job level",
  );
});

test("the staging call is driven by the RESOLVED pin, not a literal", () => {
  const step = stagingStep();
  assert.match(
    step.run,
    /--version "\$\{\{ steps\.cli_version\.outputs\.version \}\}"/,
    "the staging call does not pass the resolved pin. A hardcoded " +
      '`--version "0.4.0"` would verify a binary this extension does not ' +
      "ship, and would keep passing forever after the pin moves.",
  );
});

test("the version comparison is exact and can still fail", () => {
  const step = stagingStep();
  assert.match(
    step.run,
    /\[ "\$REPORTED" != "\$VERSION" \]/,
    'the exact-comparison guard is gone. A substring form (`case "$OUT" in ' +
      '*"$VERSION"*`) accepts `0.6.0-rc1` under a `0.6.0` pin, and an ' +
      "always-matching pattern accepts anything at all — either way the step " +
      "runs the binary and then asserts nothing about it.",
  );
  assert.match(
    step.run,
    /exit 1/,
    "the comparison no longer fails the step, so a wrong version is reported " +
      "and then ignored",
  );
});
