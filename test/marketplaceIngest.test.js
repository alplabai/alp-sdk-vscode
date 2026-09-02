// SPDX-License-Identifier: Apache-2.0
//
// The gallery is asked whether it is SERVING what the run published (#648).
//
// ── What this covers that release_gate cannot ──────────────────────────────
//
// `release_gate` reads each publish step's own outcome. That is correct, and
// deliberately so — its header argues at length against re-deriving the arming
// condition. Its limit is scope: a workflow observes what it DID, never what
// the Marketplace ACCEPTED.
//
// Measured on v0.6.0, those are ~6 minutes apart:
//
//   09:19:02.663Z  darwin-arm64 visible in the gallery
//   09:22:04       universal publish step exits 0    <- release_gate green
//   09:28:21.2Z    universal visible in the gallery
//
// The survivable case is that window. The one that is not: a publish exits 0
// and the version is never ingested — the gate then stays green forever, on a
// tag that is spent and cannot be republished.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const root = path.join(__dirname, "..");
const SCRIPT_REL = "scripts/verify-marketplace-ingest.mjs";
const WORKFLOW_REL = ".github/workflows/release-vsix.yml";
const JOB = "verify_marketplace_ingest";

let mod;
test.before(async () => {
  mod = await import(
    `file://${path.join(root, "scripts", "verify-marketplace-ingest.mjs")}`
  );
});

/**
 * The gallery's real answer for `AlpLabAI.alp-sdk`, trimmed to the fields this
 * repo reads. Captured live on 2026-09-02, not invented — and it is here for
 * one shape in particular: the universal build carries NO `targetPlatform`
 * key at all. A fixture that spelled it `"universal"` would agree with a
 * reader that had the rule backwards.
 */
const LIVE_PAYLOAD = Object.freeze({
  results: [
    {
      extensions: [
        {
          extensionName: "alp-sdk",
          publisher: { publisherName: "AlpLabAI" },
          versions: [
            {
              version: "0.6.0",
              flags: "validated",
              lastUpdated: "2026-09-01T09:28:21.2Z",
            },
            {
              version: "0.6.0",
              targetPlatform: "darwin-arm64",
              flags: "validated",
              lastUpdated: "2026-09-01T09:19:02.663Z",
            },
            {
              version: "0.5.1",
              targetPlatform: "darwin-arm64",
              flags: "validated",
              lastUpdated: "2026-08-01T16:29:29.137Z",
            },
            {
              version: "0.5.1",
              flags: "validated",
              lastUpdated: "2026-08-01T16:28:56.73Z",
            },
          ],
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Which targets a run is entitled to expect
// ---------------------------------------------------------------------------

test("only a channel that actually published is looked for", () => {
  assert.deepEqual(
    mod.expectedTargets({ universal: "success", "darwin-arm64": "skipped" }),
    ["universal"],
    "a skipped channel published nothing; demanding its ingestion would fail " +
      "a legitimate single-channel run",
  );
  assert.deepEqual(
    mod.expectedTargets({ universal: "failure", "darwin-arm64": "success" }),
    ["darwin-arm64"],
    "a FAILED publish is already release_gate's to report — re-reporting it " +
      "here would turn one defect into two",
  );
  assert.deepEqual(
    mod.expectedTargets({ universal: "skipped", "darwin-arm64": "skipped" }),
    [],
  );
  assert.deepEqual(
    mod.expectedTargets({ universal: "", "darwin-arm64": undefined }),
    [],
    "an unresolvable outcome expression reaches the script as the empty " +
      "string; it must not read as `success`",
  );
});

// ---------------------------------------------------------------------------
// Reading the gallery
// ---------------------------------------------------------------------------

test("a universal build is recognised by its ABSENT targetPlatform", () => {
  assert.deepEqual(mod.ingestedTargets(LIVE_PAYLOAD, "0.6.0"), [
    "darwin-arm64",
    "universal",
  ]);
});

test("another version's rows are not counted as this one's", () => {
  assert.deepEqual(mod.ingestedTargets(LIVE_PAYLOAD, "0.5.1"), [
    "darwin-arm64",
    "universal",
  ]);
  assert.deepEqual(
    mod.ingestedTargets(LIVE_PAYLOAD, "0.7.0"),
    [],
    "a version the gallery has never seen must read as absent, not as " +
      "whatever the newest row happens to be",
  );
});

test("a malformed payload answers empty rather than throwing", () => {
  for (const payload of [
    null,
    undefined,
    {},
    { results: [] },
    { results: [{ extensions: [] }] },
    { results: [{ extensions: [{ versions: "nope" }] }] },
    { results: [{ extensions: [{ versions: [null, 7, "x"] }] }] },
    { results: [{ extensions: [{ versions: [{ version: 606 }] }] }] },
  ]) {
    assert.deepEqual(
      mod.ingestedTargets(payload, "0.6.0"),
      [],
      `payload ${JSON.stringify(payload)} must not throw`,
    );
  }
});

test("an empty-string targetPlatform is read as universal, not as a target", () => {
  const payload = {
    results: [
      {
        extensions: [{ versions: [{ version: "1.0.0", targetPlatform: "" }] }],
      },
    ],
  };
  assert.deepEqual(mod.ingestedTargets(payload, "1.0.0"), ["universal"]);
});

test("missingTargets names what is expected and not yet served", () => {
  assert.deepEqual(
    mod.missingTargets(["darwin-arm64", "universal"], ["darwin-arm64"]),
    ["universal"],
  );
  assert.deepEqual(mod.missingTargets(["universal"], ["universal"]), []);
  assert.deepEqual(mod.missingTargets([], ["universal"]), []);
});

// ---------------------------------------------------------------------------
// The wait has to outlast the thing it waits for
// ---------------------------------------------------------------------------

test("the default backoff budget outlasts the measured ingestion lag", () => {
  let total = 0;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    total += mod.backoffMs(attempt);
  }
  assert.ok(
    total >= 600_000,
    `the 10-attempt budget is ${Math.round(total / 1000)}s. The universal ` +
      "target took ~360s to appear on v0.6.0, and a budget that expires near " +
      "the value it waits for reports a false absence on a slow day.",
  );
  assert.ok(
    mod.backoffMs(1) === 0,
    "the first attempt must not sleep — darwin-arm64 was already visible " +
      "before its own publish step's sibling finished",
  );
});

// ---------------------------------------------------------------------------
// The job is wired, and cannot be quietly neutered
// ---------------------------------------------------------------------------

const workflow = yaml.load(
  fs.readFileSync(path.join(root, WORKFLOW_REL), "utf8"),
);
const job = workflow.jobs?.[JOB];

test("the job exists and depends on both publishing jobs", () => {
  assert.ok(job, `${WORKFLOW_REL} declares no \`${JOB}\` job`);
  assert.deepEqual(
    [...(job.needs ?? [])].sort(),
    ["package_and_publish", "package_darwin_arm64"],
    "it reads both jobs' outcomes, so it must wait for both",
  );
});

test("nothing neuters the job", () => {
  assert.notEqual(
    job.if,
    false,
    "an `if: false` leaves a job that is listed and never runs",
  );
  assert.ok(
    String(job.if ?? "").includes("!cancelled()"),
    "it must run even when a publish FAILED — release_gate reports that, and " +
      "this reports whether anything nevertheless reached customers",
  );
  assert.notEqual(job["continue-on-error"], true);
  for (const step of job.steps ?? []) {
    assert.notEqual(
      step["continue-on-error"],
      true,
      `step "${step.name ?? step.uses}" is continue-on-error, so its failure ` +
        "is a green check",
    );
  }
});

test("the expected targets come from the jobs' outcomes, never a literal", () => {
  const call = (job.steps ?? []).find(
    (s) => typeof s.run === "string" && s.run.includes(SCRIPT_REL),
  );
  assert.ok(call, `no step runs ${SCRIPT_REL}`);
  assert.match(
    call.run,
    /--universal\s+"\$\{\{\s*needs\.package_and_publish\.outputs\.marketplace_outcome\s*\}\}"/,
    "the universal target must be claimed from that job's own outcome",
  );
  assert.match(
    call.run,
    /--darwin-arm64\s+"\$\{\{\s*needs\.package_darwin_arm64\.outputs\.marketplace_outcome\s*\}\}"/,
    "and darwin-arm64 from its own — a literal `success` here would demand " +
      "ingestion for a channel that never published",
  );
  assert.doesNotMatch(
    call.run,
    /--universal\s+"?success"?\s/,
    "a hardcoded outcome makes the derivation decorative",
  );
});

test("the packaged version is cross-checked against a pushed tag", () => {
  const resolve = (job.steps ?? []).find((s) => s.id === "packaged");
  assert.ok(resolve, "no step resolves the packaged version");
  assert.match(
    resolve.run,
    /require\('\.\/package\.json'\)\.version/,
    "the version must come from what was packaged",
  );
  // PRESENCE is not LIVENESS, and asserting the former is how this test first
  // shipped: replacing the guard with `if false; then` left every string below
  // sitting inside a dead branch, and a `/GITHUB_REF_NAME/` match passed on it.
  // Found by mutating this file's own subject, not by reading it.
  assert.match(
    resolve.run,
    /if\s+\[\s+"\$\{\{\s*github\.event_name\s*\}\}"\s+=\s+"push"\s+\]/,
    "the tag cross-check must be REACHED on a push, not merely present — a " +
      "dead branch still contains every string an existence check looks for",
  );
  assert.match(
    resolve.run,
    /GITHUB_REF_NAME/,
    "and it must compare against the tag; verifying ingestion of a version " +
      "the tag did not publish is a green that means nothing",
  );
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the live fixture really exercises both target shapes", () => {
  const versions = LIVE_PAYLOAD.results[0].extensions[0].versions;
  assert.ok(
    versions.some((v) => !("targetPlatform" in v)),
    "no universal row in the fixture — the absent-key rule is unexercised",
  );
  assert.ok(
    versions.some((v) => v.targetPlatform === "darwin-arm64"),
    "no platform row in the fixture",
  );
});
