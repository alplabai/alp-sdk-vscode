// SPDX-License-Identifier: Apache-2.0
//
// #603: the `hostPrerequisites` rollup row's button was dead at the pinned
// tan 0.6.0. `actionFor` (planner.ts) matched a missing prerequisite to a row
// by `p.tool === check.name` — that worked at v0.3.1, which emitted one check
// PER TOOL, but 0.6.0 rolls `cmake`/`ninja` into ONE `hostPrerequisites` check
// while `missingPrerequisites` stays keyed by tool. Nothing matched, so the
// button was `action: null` on the exact row that exists to install these two.
//
// The fixture: captured from the pinned tan 0.6.0 binary (`tan doctor
// --format json`) against a real `tan init --template minimal-app --som
// E1M-AEN801` project, cmake+ninja off PATH, `--sdk-root` resolved to a real
// alp-sdk v0.16.0-rc1 checkout. The ONLY edits are `/Users/...` -> `/home/dev/`
// path rewrites for the public repo (verified: zero `/Users/` occurrences).
// This is the repo's first FAILING-state doctor fixture at this pin — both
// prior 0.6.0 captures (`tan-doctor.v0.6.0.darwin.json`) carry
// `hostPrerequisites: pass` / `missingPrerequisites: null`, which is exactly
// why the dead button survived every gate until now.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");

const envelope = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "tan-doctor.v0.6.0.missing-prereqs.darwin.json",
    ),
    "utf-8",
  ),
);
const data = envelope.data;

const plan = (overData = data, over = {}) =>
  planDependencyReport({
    data: overData,
    bootstrapRunning: false,
    cli: { installed: "0.6.0", latest: { version: "0.6.0", kind: "pin" } },
    compareVersions: () => "same",
    host: "darwin",
    ...over,
  });

const rowFor = (report, name) => report.rows.find((r) => r.name === name);

test("the fixture is the real pinned tan v0.6.0 failing-state doctor envelope", () => {
  assert.equal(envelope.command, "doctor");
  assert.equal(envelope.exitCode, 4);
  assert.deepEqual(data.missingPrerequisites, [
    { tool: "cmake", command: "brew install cmake" },
    { tool: "ninja", command: "brew install ninja" },
  ]);
  const rollup = data.checks.find((c) => c.name === "hostPrerequisites");
  assert.equal(rollup.status, "fail");
  // No per-tool `cmake` / `ninja` check exists at this pin — that absence is
  // the whole bug.
  assert.equal(
    data.checks.some((c) => c.name === "cmake" || c.name === "ninja"),
    false,
  );
});

test("the hostPrerequisites row gets an install action covering BOTH tools, tan's commands verbatim", () => {
  const report = plan();
  const row = rowFor(report, "hostPrerequisites");
  assert.ok(row, "the row must exist — it is one of tan's own checks");
  assert.ok(
    row.action,
    "hostPrerequisites fail state=needs-you action=NONE is the #603 bug — " +
      "this must no longer be true",
  );
  assert.equal(row.action.kind, "command");
  assert.equal(row.action.effect, "install");
  assert.deepEqual(row.action.commands, [
    { tool: "cmake", command: "brew install cmake" },
    { tool: "ninja", command: "brew install ninja" },
  ]);
  assert.deepEqual(
    row.action.omittedTools,
    [],
    "both tools got a real command — nothing is omitted",
  );
  // Every action carries a tooltip a customer can read before pressing.
  assert.equal(typeof row.action.title, "string");
  assert.ok(row.action.title.length > 0);
});

test("no orphaned prerequisite — every non-null command bound to a row", () => {
  const report = plan();
  assert.deepEqual(report.orphanedPrerequisites, []);
});

// ---------------------------------------------------------------------------
// "reported, never silently dropped" also covers the row itself, not only
// `orphanedPrerequisites` (#603, round 5, major 5). A tool tan names with
// `command: null` legitimately offers no button — but when ALL leftover
// entries are null, `leftoverBound` is empty, no rollup action exists at
// all, and `rollupActionTitle` (the only place that would otherwise say "tan
// reported no install command for X") is never reached, because there is no
// action for it to BE that action's title. Round 1 measured the partial case
// (one bound, one omitted); this is the total-omission ground state,
// unexamined until now.
// ---------------------------------------------------------------------------

test("every leftover tool omitted (command: null for all of them) — the row itself still names them, not silence (#603 round 5, major 5)", () => {
  const allOmitted = {
    ...data,
    missingPrerequisites: [
      { tool: "cmake", command: null },
      { tool: "ninja", command: null },
    ],
  };
  const row = rowFor(plan(allOmitted), "hostPrerequisites");

  assert.equal(
    row.action,
    null,
    "nothing is installable — there is genuinely no button to offer",
  );
  assert.match(
    row.detail,
    /tan reported no install command for cmake, ninja/,
    "the row's own detail is the only channel left once there is no action " +
      "to carry `omittedTools` on a button that does not exist",
  );
  // No double full stop (#603, round 6, nit 7): tan's own detail already
  // ends in one, and joining it with a second sentence unstripped read as
  // "...bootstrap.json). — tan reported...", two sentences bolted together
  // rather than one continuous clause.
  assert.equal(
    row.detail,
    "missing from PATH: cmake, ninja (facts from alp-sdk " +
      "/home/dev/alp-sdk/metadata/bootstrap.json) — tan reported no " +
      "install command for cmake, ninja.",
  );
  assert.doesNotMatch(row.detail, /\)\. — /);
  // Not reported as orphaned: tan's `command: null` is a real answer, not a
  // command that bound to nothing (see the null-command test above).
  assert.deepEqual(plan(allOmitted).orphanedPrerequisites, []);
});

test("a tan detail that does NOT end in a full stop keeps its last character", () => {
  // The period strip is guarded (`endsWith(".") ? slice(0, -1) : detail`) and
  // every fixture in this file happens to end in one, so an unguarded
  // `slice(0, -1)` passed every gate while silently eating a character of
  // tan's verbatim text — exactly the class of gap round 6 named: a guard
  // whose false arm no fixture reaches. tan's detail is not required to end
  // in punctuation, and this repo does not edit tan's words.
  const bare = "missing from PATH: cmake, ninja";
  const noStop = {
    ...data,
    missingPrerequisites: [
      { tool: "cmake", command: null },
      { tool: "ninja", command: null },
    ],
    checks: data.checks.map((c) =>
      c.name === "hostPrerequisites" ? { ...c, detail: bare } : c,
    ),
  };
  const row = rowFor(plan(noStop), "hostPrerequisites");
  assert.equal(
    row.detail,
    `${bare} — tan reported no install command for cmake, ninja.`,
  );
  assert.ok(
    row.detail.startsWith(bare),
    "tan's own sentence must survive whole — a bare `slice(0, -1)` would " +
      "truncate it to `...ninj`",
  );
});

test("a fully-covered row's detail is tan's own text, untouched", () => {
  const row = rowFor(plan(), "hostPrerequisites");
  assert.equal(
    row.detail,
    data.checks.find((c) => c.name === "hostPrerequisites").detail,
  );
});

test("a mixed row (one tool named, one command: null) says so in the title — not indistinguishable from a full row", () => {
  // #603 design item 5: a partial button must not read like a full one. tan
  // named a real command for cmake but none for ninja — the button installs
  // only cmake, and pressing it can leave the row still failing for ninja.
  const mixed = {
    ...data,
    missingPrerequisites: [
      { tool: "cmake", command: "brew install cmake" },
      { tool: "ninja", command: null },
    ],
  };
  const row = rowFor(plan(mixed), "hostPrerequisites");
  assert.deepEqual(row.action.commands, [
    { tool: "cmake", command: "brew install cmake" },
  ]);
  assert.deepEqual(
    row.action.omittedTools,
    ["ninja"],
    "the structured signal the consent screen builds its own clause from " +
      "(#603 second review, minor 7) — not re-derived from title's prose",
  );
  assert.match(row.action.title, /brew install cmake/);
  assert.match(
    row.action.title,
    /no install command for ninja/,
    "a mixed row's title must name the tool it cannot cover — otherwise a " +
      "clean press reads as 'this row is now fixed' when it is not",
  );

  // The full (both-covered) row from the unmodified fixture must NOT carry
  // that sentence — the whole point is that the two are distinguishable.
  const full = rowFor(plan(), "hostPrerequisites");
  assert.doesNotMatch(full.action.title, /no install command for/);

  // The clause belongs to the TITLE here and nowhere else. `detail` gets it
  // only when there is no action to carry it (the all-omitted row above), and
  // the `leftoverBound.length === 0` conjunct is the only thing enforcing
  // that. Without this assertion, dropping the conjunct leaves every gate
  // green while a partial row claims the same omission twice — once on the
  // button, once under it — which is the duplicate `rollupActionTitle` was
  // written to avoid.
  assert.equal(
    row.detail,
    data.checks.find((c) => c.name === "hostPrerequisites").detail,
    "a partial row's detail is tan's own text: the omission is on the title",
  );
});

// ---------------------------------------------------------------------------
// The orphan invariant (#603 design item 2 / gate iii): the NEXT rename must
// be visible, not silently swallowed the way this one was.
// ---------------------------------------------------------------------------

test("renaming the rollup check surfaces the orphan, it does not silently drop the action", () => {
  const renamed = {
    ...data,
    checks: data.checks.map((c) =>
      c.name === "hostPrerequisites"
        ? { ...c, name: "hostPrerequisitesV2" }
        : c,
    ),
  };
  const report = plan(renamed);

  // The row that used to carry the button is simply gone (renamed); nothing
  // else in this envelope may quietly absorb cmake/ninja's commands.
  assert.equal(rowFor(report, "hostPrerequisites"), undefined);
  const newRow = rowFor(report, "hostPrerequisitesV2");
  assert.equal(
    newRow.action,
    null,
    "no other row may synthesise an action for prerequisites tan never tied to it",
  );

  // The invariant: this must be SURFACED, not a quiet `action: null` that
  // reads identically to "nothing was missing".
  assert.deepEqual(report.orphanedPrerequisites, [
    { tool: "cmake", command: "brew install cmake" },
    { tool: "ninja", command: "brew install ninja" },
  ]);
});

test("a null command is never counted as orphaned — there is nothing to carry", () => {
  // tan's `command: null` is itself a real answer ("no confirmed install
  // command for this host"). A row that legitimately offers nothing must not
  // be reported as a dropped prerequisite.
  const renamed = {
    ...data,
    checks: data.checks.map((c) =>
      c.name === "hostPrerequisites"
        ? { ...c, name: "hostPrerequisitesV2" }
        : c,
    ),
    missingPrerequisites: [
      { tool: "cmake", command: null },
      { tool: "ninja", command: null },
    ],
  };
  const report = plan(renamed);
  assert.deepEqual(report.orphanedPrerequisites, []);
});
