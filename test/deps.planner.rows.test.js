// SPDX-License-Identifier: Apache-2.0
//
// MEMBERSHIP, not shape. The dependency table's rows are DERIVED from tan's
// `data.checks[]` — every check gets a row keyed on its name, plus exactly one
// host-owned `tan` row. A check nobody wrote down (`gperf`, or whatever tan adds
// next) must still light up a row with zero change in this extension, so these
// tests loop the captured envelope rather than naming rows by hand.

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

const plan = (over = {}) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: { installed: "0.3.1", latest: { version: "0.3.1", kind: "pin" } },
    compareVersions: () => "same",
    ...over,
  });

test("the fixture is the real pinned tan v0.3.1 doctor envelope", () => {
  // Captured from `tan 0.3.1 doctor --build --format json`, not hand-written: a
  // hand-written fixture asserts what we IMAGINE tan emits. The only edit is
  // `project.root` / `project.boardYaml`, whose captured values were the
  // capturing machine's absolute paths (public repo); every byte of `data`,
  // `issues`, `command`, `ok` and `exitCode` is tan's own.
  assert.equal(envelope.command, "doctor");
  assert.equal(envelope.exitCode, 4);
  assert.ok(Array.isArray(data.checks) && data.checks.length > 0);
  assert.equal(typeof data.summary.fail, "number");
  // The whole reason the action is feature-detected: v0.3.1 emits no such key.
  assert.equal(
    Object.prototype.hasOwnProperty.call(data, "missingPrerequisites"),
    false,
  );
});

test("every check name in the envelope produces a row, by name", () => {
  const { rows } = plan();
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const check of data.checks) {
    assert.ok(
      byName.has(check.name),
      `no row for check "${check.name}" — rows must derive from checks, not an allowlist`,
    );
  }
});

test("row count is exactly checks + 1 (the host-owned tan row)", () => {
  const { rows } = plan();
  assert.equal(rows.length, data.checks.length + 1);
  const tanRow = rows.find((r) => r.name === TAN_ROW_NAME);
  assert.ok(tanRow, "tan cannot check itself — the host owns that one row");
  assert.equal(tanRow.installed, "0.3.1");
});

test("rows keep tan's own check order", () => {
  const { rows } = plan();
  assert.deepEqual(
    rows.slice(0, data.checks.length).map((r) => r.name),
    data.checks.map((c) => c.name),
  );
});

test("a check nobody wrote down still yields a row with a humanised label", () => {
  // `gperf` is in neither the label table nor the fix table, and tan has no
  // such check today. Adding one upstream must need no change here.
  const withUnknown = {
    ...data,
    checks: [
      ...data.checks,
      {
        name: "gperf",
        status: "fail",
        detail: "gperf not found on PATH",
        fix: "Install gperf.",
      },
      { name: "dtcCompiler", status: "warn", detail: "dtc not found" },
    ],
  };
  const { rows } = plan({ data: withUnknown });
  assert.equal(rows.length, withUnknown.checks.length + 1);

  const gperf = rows.find((r) => r.name === "gperf");
  assert.ok(gperf, "an unknown check name must still produce a row");
  assert.equal(gperf.label, "Gperf");
  assert.equal(gperf.detail, "gperf not found on PATH");

  const dtc = rows.find((r) => r.name === "dtcCompiler");
  assert.ok(dtc);
  assert.equal(dtc.label, "Dtc Compiler");
});

test("rows are not filtered by status — pass, warn and fail all appear", () => {
  const { rows } = plan();
  const statuses = new Set(data.checks.map((c) => c.status));
  assert.ok(statuses.size > 1, "fixture must cover more than one status");
  for (const status of statuses) {
    const names = data.checks
      .filter((c) => c.status === status)
      .map((c) => c.name);
    for (const name of names) {
      assert.ok(
        rows.some((r) => r.name === name),
        `row for "${name}" (status ${status}) was dropped`,
      );
    }
  }
});

test("a check with a label but no fix-map entry still yields a row", () => {
  // `yoctoHost` is labelled and unfixable; a fix-table gate would drop it.
  const { rows } = plan();
  const row = rows.find((r) => r.name === "yoctoHost");
  assert.ok(row);
  assert.equal(row.label, "Yocto host");
  assert.equal(row.action, null);
});

test("check rows never fabricate a version", () => {
  const { rows } = plan();
  for (const row of rows.filter((r) => r.name !== TAN_ROW_NAME)) {
    assert.equal(row.installed, null, `${row.name} invented an installed cell`);
    assert.equal(row.latest, null, `${row.name} invented a latest cell`);
  }
});
