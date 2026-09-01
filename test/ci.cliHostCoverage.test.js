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

/** The hosts this pin actually publishes an asset for. */
function hostsWithAnAsset() {
  const declaredGaps = new Set(
    HOSTS_WITHOUT_RELEASE_ASSET[SUPPORTED_CLI_VERSION] ?? [],
  );
  return Object.keys(TARGETS).filter((host) => !declaredGaps.has(host));
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

test("every host with a published asset is executed by CI", () => {
  const required = hostsWithAnAsset();
  const covered = new Set(hostsCoveredByCi());

  const missing = required.filter((host) => !covered.has(host));
  assert.deepEqual(
    missing,
    [],
    `these hosts have a published tan asset at the ${SUPPORTED_CLI_VERSION} ` +
      `pin and nothing in CI ever runs it: ${missing.join(", ")}. Either add ` +
      `a matrix entry to \`${JOB}\` (ubuntu-latest / windows-latest / ` +
      `macos-latest / macos-13 cover linux/x64, win32/x64, darwin/arm64 and ` +
      `darwin/x64 respectively), or, if tan genuinely stopped publishing for ` +
      `the host, declare it in HOSTS_WITHOUT_RELEASE_ASSET. Shipping a CLI ` +
      `nobody has ever executed on the host it targets is what #446 was open ` +
      `on.`,
  );
});

test("CI does not claim a host the pin publishes nothing for", () => {
  const required = new Set(hostsWithAnAsset());
  const spurious = hostsCoveredByCi().filter((host) => !required.has(host));
  assert.deepEqual(
    spurious,
    [],
    `\`${JOB}\` runs for ${spurious.join(", ")}, which ` +
      `HOSTS_WITHOUT_RELEASE_ASSET declares has no asset at ` +
      `${SUPPORTED_CLI_VERSION}. That job would take the staging script's ` +
      `exit 2 and report a green SKIP forever — a host that looks covered in ` +
      `the checks list and is not. Drop the entry, or drop the declared gap ` +
      `if it is the stale one.`,
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
    hostsCoveredByCi().length >= 4,
    "the matrix parsed to fewer than four entries, so the assertions above " +
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
  // file accepts a prerelease. This asserts the new job HAS one, so it cannot
  // quietly stop resolving the pin and start verifying whatever `--version`
  // defaults to.
  const job = workflow.jobs[JOB];
  const resolver = job.steps.find((step) => step.id === "cli_version");
  assert.ok(
    resolver,
    `\`${JOB}\` has no \`cli_version\` step — without it the staging call has ` +
      `no --version and would resolve the LATEST release rather than the pin, ` +
      `verifying a binary this extension does not ship.`,
  );
  assert.match(resolver.run, /SUPPORTED_CLI_VERSION = "\[0-9\]/);
});
