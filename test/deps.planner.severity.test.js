// SPDX-License-Identifier: Apache-2.0
//
// Status is tan's answer, passed through verbatim, and the report publishes NO
// boolean readiness verdict. tan caps an absent PATH tool at `warn`
// (tan-cli#103, unmerged), so any `ok: counts.fail === 0` field prints "all
// required tools present" while `ninja` is missing — the live bug at
// src/toolchain.ts:244. Counts are exposed; the verdict is not.

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

test("every row's status is tan's check status, verbatim", () => {
  const { rows } = plan();
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const check of data.checks) {
    assert.equal(
      byName.get(check.name).status,
      check.status,
      `status for "${check.name}" was rewritten`,
    );
  }
});

test("a status tan invents later survives the trip untouched", () => {
  const withNewStatus = {
    ...data,
    checks: [
      ...data.checks,
      { name: "gperf", status: "skipped", detail: "not applicable on Windows" },
    ],
  };
  const row = plan({ data: withNewStatus }).rows.find(
    (r) => r.name === "gperf",
  );
  assert.equal(row.status, "skipped");
});

test("an absent tool capped at warn stays warn — never promoted to fail", () => {
  // The real fixture: ninja is missing and tan reports `warn`. Re-deriving a
  // status from "required-ness" is what made the panel lie in both directions.
  const ninja = data.checks.find((c) => c.name === "ninja");
  assert.equal(ninja.status, "warn");
  assert.match(ninja.detail, /ninja not found on PATH/);
  const row = plan().rows.find((r) => r.name === "ninja");
  assert.equal(row.status, "warn");
});

test("counts are tan's summary, verbatim", () => {
  const { counts } = plan();
  assert.deepEqual(counts, data.summary);
  assert.equal(counts.pass, data.summary.pass);
  assert.equal(counts.warn, data.summary.warn);
  assert.equal(counts.fail, data.summary.fail);
});

test("the report publishes no boolean readiness verdict", () => {
  const report = plan();
  for (const forbidden of ["ok", "ready", "recommended", "missingRequired"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(report, forbidden),
      false,
      `report.${forbidden} re-introduces the "All required tools present" lie`,
    );
  }
});

test("no verdict appears even when tan reports zero failures", () => {
  // fail:0 with warn:6 is exactly the tan-cli#103 shape: nothing "failed", and
  // ninja is still missing. Anything boolean derived here would read green.
  const green = {
    ...data,
    summary: { pass: 4, warn: 6, fail: 0 },
    checks: data.checks.map((c) =>
      c.status === "fail" ? { ...c, status: "warn" } : c,
    ),
  };
  const report = plan({ data: green });
  assert.equal(Object.prototype.hasOwnProperty.call(report, "ok"), false);
  assert.deepEqual(report.counts, { pass: 4, warn: 6, fail: 0 });
  assert.ok(report.rows.some((r) => r.name === "ninja" && r.status === "warn"));
});

test("the host-owned tan row does not move tan's counts", () => {
  const missing = plan({
    cli: { installed: null, latest: { version: "0.3.1", kind: "pin" } },
  });
  assert.equal(
    missing.rows.find((r) => r.name === TAN_ROW_NAME).status,
    "fail",
  );
  assert.deepEqual(missing.counts, data.summary);
});
