// SPDX-License-Identifier: Apache-2.0
//
// `updateAvailable` is true ONLY for something that CHASES latest. The `tan`
// CLI is PINNED to SUPPORTED_CLI_VERSION: a customer already on a newer tan must
// never be told to "update" to the older pinned one. The two are modelled
// explicitly by `latest.kind` ("release" vs "pin"), and the version comparison
// is INJECTED — this repo holds exactly one SemVer compare (`cliSkew`).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  planDependencyReport,
  TAN_ROW_NAME,
} = require("../packages/alp-core/dist/deps/planner.js");

const envelope = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "tan-doctor-build.v0.3.1.json"),
    "utf-8",
  ),
);
const data = envelope.data;

const plan = (cli, compareVersions = () => "same") =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli,
    compareVersions,
  });

const tanRow = (report) => report.rows.find((r) => r.name === TAN_ROW_NAME);

test("a PIN is never an update, whatever the comparator says", () => {
  const report = plan(
    { installed: "0.3.0", latest: { version: "0.3.1", kind: "pin" } },
    () => "behind",
  );
  const row = tanRow(report);
  assert.equal(row.latest.kind, "pin");
  assert.equal(row.latest.version, "0.3.1");
  assert.equal(
    row.updateAvailable,
    false,
    "a pinned dependency has no update to offer — the extension requires this exact version",
  );
});

test("a customer AHEAD of the pin is never told to update", () => {
  const report = plan(
    { installed: "0.4.0", latest: { version: "0.3.1", kind: "pin" } },
    () => "ahead-minor",
  );
  assert.equal(tanRow(report).updateAvailable, false);
  assert.equal(tanRow(report).installed, "0.4.0");
});

test("a RELEASE that is behind is an update", () => {
  const seen = [];
  const report = plan(
    { installed: "0.3.1", latest: { version: "0.4.0", kind: "release" } },
    (installed, target) => {
      seen.push([installed, target]);
      return "behind";
    },
  );
  assert.equal(tanRow(report).updateAvailable, true);
  // The injected comparator gets the two versions verbatim; no second SemVer
  // implementation lives in core.
  assert.deepEqual(seen, [["0.3.1", "0.4.0"]]);
});

test("a RELEASE that is not behind is not an update", () => {
  for (const skew of ["same", "ahead-patch", "ahead-minor", "unknown"]) {
    const report = plan(
      { installed: "0.4.0", latest: { version: "0.4.0", kind: "release" } },
      () => skew,
    );
    assert.equal(
      tanRow(report).updateAvailable,
      false,
      `skew "${skew}" must not read as an update`,
    );
  }
});

test("an unresolved binary reports no version and no update", () => {
  const report = plan(
    { installed: null, latest: { version: "0.4.0", kind: "release" } },
    () => "unknown",
  );
  const row = tanRow(report);
  assert.equal(row.installed, null, "never fabricate a version");
  assert.equal(row.status, "fail");
  assert.equal(row.updateAvailable, false);
});

test("check rows carry no latest and never claim an update", () => {
  const report = plan(
    { installed: "0.3.1", latest: { version: "0.4.0", kind: "release" } },
    () => "behind",
  );
  for (const row of report.rows.filter((r) => r.name !== TAN_ROW_NAME)) {
    assert.equal(row.latest, null, `${row.name} invented a latest`);
    assert.equal(row.updateAvailable, false, `${row.name} claimed an update`);
  }
});
