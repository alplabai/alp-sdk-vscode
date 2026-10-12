// SPDX-License-Identifier: Apache-2.0
//
// Artifact provenance on the dependency consent screen (#467).
//
// tan 0.7.0-rc1 (tan-cli#1066) flattens alp-sdk's `artifactProvenance` onto
// every `data.missingPrerequisites[]` entry: `{tool, command, tier, licence,
// sourceUrl, sizeBytes}`, `null` where alp-sdk declares nothing. What this
// pins:
//
//  - the planner carries each entry's provenance on the very step that runs,
//    read from tan and from nothing else (the real rc1 capture below);
//  - an old tan (no keys) and a malformed value both degrade to "not
//    reported", per field, never to a crash or an invented value;
//  - a multi-tool rollup never pins one tool's licence on another;
//  - a producer tier `C` line starts UNCHECKED and a tier `B` line carries the
//    elevation note;
//  - `Runs:` stays the command, never the upstream `sourceUrl`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");
const {
  planInstallConsent,
} = require("../packages/alp-core/dist/deps/consent.js");
const {
  normaliseProvenance,
  formatByteCount,
  NO_PROVENANCE,
} = require("../packages/alp-core/dist/deps/provenance.js");

const root = path.join(__dirname, "..");

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8"));

const plan = (data) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: {
      installed: "0.7.0-rc1",
      latest: { version: "0.7.0-rc1", kind: "pin" },
    },
    compareVersions: () => "same",
    host: "darwin",
  });

const rollupOf = (report) =>
  report.rows.find((row) => row.name === "hostPrerequisites");

/** A `command` row over the given steps, as the planner builds one. */
const commandRow = (name, steps) => ({
  name,
  label: name,
  status: "fail",
  state: "will-install",
  detail: "",
  hint: null,
  installed: null,
  latest: null,
  updateAvailable: false,
  action: {
    kind: "command",
    commands: steps,
    omittedTools: [],
    effect: "install",
    title: steps.map((step) => step.command).join("; "),
  },
});

const step = (tool, provenance) => ({
  tool,
  command: `brew install ${tool}`,
  provenance: { ...NO_PROVENANCE, ...provenance },
});

// ---------------------------------------------------------------------------
// The planner, against real captures
// ---------------------------------------------------------------------------

test("provenance PRESENT: the rc1 capture's entries reach the step that runs", () => {
  // Arrange -- tan 0.7.0-rc1 against alp-sdk v0.16.0, cmake and ninja off PATH.
  const envelope = fixture("tan-doctor.v0.7.0-rc1.missing-prereqs.darwin.json");

  // Act
  const steps = rollupOf(plan(envelope.data)).action.commands;

  // Assert -- tan's values, verbatim, on the step carrying tan's command.
  assert.deepEqual(steps, [
    {
      tool: "cmake",
      command: "brew install cmake",
      provenance: {
        tier: "A",
        licence: "BSD-3-Clause",
        sourceUrl: "https://cmake.org/",
        sizeBytes: null,
      },
    },
    {
      tool: "ninja",
      command: "brew install ninja",
      provenance: {
        tier: "A",
        licence: "Apache-2.0",
        sourceUrl: "https://ninja-build.org/",
        sizeBytes: null,
      },
    },
  ]);
});

test("provenance ABSENT: an old tan's entries carry no keys and read not-reported", () => {
  // Arrange -- the pinned-0.6.0 capture: `{tool, command}` only.
  const envelope = fixture("tan-doctor.v0.6.0.missing-prereqs.darwin.json");

  // Act
  const report = plan(envelope.data);
  const [item] = planInstallConsent([rollupOf(report)], "darwin");

  // Assert
  for (const s of rollupOf(report).action.commands) {
    assert.deepEqual(s.provenance, NO_PROVENANCE, s.tool);
  }
  assert.equal(item.tier, null);
  assert.equal(item.licence, null);
  assert.equal(item.size, null);
  assert.equal(item.licenceGated, false);
});

test("the rc1 rollup renders each tool's licence, never one for both", () => {
  // Arrange
  const envelope = fixture("tan-doctor.v0.7.0-rc1.missing-prereqs.darwin.json");

  // Act
  const [item] = planInstallConsent([rollupOf(plan(envelope.data))], "darwin");

  // Assert -- tiers agree, so one word; licences differ, so per tool.
  assert.equal(item.tier, "A");
  assert.equal(item.licence, "cmake: BSD-3-Clause; ninja: Apache-2.0");
  assert.equal(item.size, null, "alp-sdk declares sizeBytes: null on all 8");
  assert.deepEqual(item.source, ["brew install cmake", "brew install ninja"]);
});

// ---------------------------------------------------------------------------
// Normalisation of untrusted values
// ---------------------------------------------------------------------------

test("MALFORMED provenance degrades per field, never wholesale", () => {
  // Arrange / Act
  const read = normaliseProvenance({
    tool: "cmake",
    command: "brew install cmake",
    tier: 3,
    licence: "BSD-3-Clause",
    sourceUrl: { href: "https://cmake.org/" },
    sizeBytes: "4096",
  });

  // Assert -- the one good field survives its three bad neighbours.
  assert.deepEqual(read, {
    tierUnreadable: true,
    tier: null,
    licence: "BSD-3-Clause",
    sourceUrl: null,
    sizeBytes: null,
  });
});

test("sizeBytes must be a non-negative whole number", () => {
  for (const bad of [-1, 1.5, true, Number.NaN, Infinity, 2 ** 60, "12"]) {
    assert.equal(
      normaliseProvenance({ sizeBytes: bad }).sizeBytes,
      null,
      String(bad),
    );
  }
  assert.equal(normaliseProvenance({ sizeBytes: 0 }).sizeBytes, 0);
  assert.equal(normaliseProvenance({ sizeBytes: 4096 }).sizeBytes, 4096);
});

test("strings only, and an empty one is not a value", () => {
  assert.equal(normaliseProvenance({ licence: "" }).licence, null);
  assert.equal(normaliseProvenance({ licence: "   " }).licence, null);
  assert.equal(normaliseProvenance({ tier: ["A"] }).tier, null);
  assert.deepEqual(normaliseProvenance(null), NO_PROVENANCE);
  assert.deepEqual(normaliseProvenance("cmake"), NO_PROVENANCE);
});

test("a byte count is formatted, with the exact figure beside a rounded one", () => {
  assert.equal(formatByteCount(512), "512 bytes");
  assert.equal(formatByteCount(1), "1 byte");
  assert.equal(formatByteCount(4096), "4 KiB");
  assert.equal(formatByteCount(2758656), "2.63 MiB (2758656 bytes)");
});

// ---------------------------------------------------------------------------
// Multi-tool rollup rendering
// ---------------------------------------------------------------------------

test("a rollup whose steps disagree renders each field per tool, in dispatch order", () => {
  // Arrange
  const row = commandRow("hostPrerequisites", [
    step("cmake", { tier: "A", licence: "BSD-3-Clause", sizeBytes: 4194304 }),
    step("ninja", { tier: "B", licence: null, sizeBytes: null }),
  ]);

  // Act
  const [item] = planInstallConsent([row], "darwin");

  // Assert
  assert.equal(item.tier, "cmake: A; ninja: B");
  assert.equal(item.licence, "cmake: BSD-3-Clause; ninja: not reported");
  assert.equal(item.size, "cmake: 4 MiB; ninja: not reported");
  assert.equal(item.elevationTier, true, "ANY step at tier B");
  assert.equal(item.licenceGated, false);
});

test("a rollup whose steps agree renders the one value, not a list", () => {
  const row = commandRow("hostPrerequisites", [
    step("cmake", { tier: "A", licence: "MIT", sizeBytes: 1024 }),
    step("ninja", { tier: "A", licence: "MIT", sizeBytes: 1024 }),
  ]);
  const [item] = planInstallConsent([row], "darwin");
  assert.equal(item.tier, "A");
  assert.equal(item.licence, "MIT");
  assert.equal(item.size, "1 KiB");
});

// ---------------------------------------------------------------------------
// The QuickPick: tier C unchecked, tier B elevation, Runs: is the command
// ---------------------------------------------------------------------------

function loadAdapter() {
  const shown = [];
  const modPath = require.resolve(
    path.join(root, "out", "deps", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      window: {
        showQuickPick: async (items) => {
          shown.push(items);
          return items.filter((item) => item.picked);
        },
      },
      Uri: {},
    },
    "../alpCli/vscodeAdapter": {},
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {},
    "../environment/vscodeAdapter": {},
    "../toolchain": { runToolchainFix() {}, TOOLCHAIN_FIX_RUN_NAME: "x" },
    "../util": { log() {}, isRunActive: () => false },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return { mod: require(modPath), shown };
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

test("a producer tier C line starts UNCHECKED, so it is never fetched by default", async () => {
  // Arrange
  const { mod, shown } = loadAdapter();
  const gated = commandRow("vendorCompiler", [
    step("vendorCompiler", { tier: "C", licence: "Proprietary" }),
  ]);
  const ordinary = commandRow("ninja", [step("ninja", { tier: "A" })]);

  // Act -- the stub answers with exactly the lines left checked.
  const consented = await mod.confirmDependencyInstalls(
    [gated, ordinary],
    "darwin",
  );

  // Assert
  const [gatedPick, ordinaryPick] = shown[0];
  assert.equal(gatedPick.picked, false);
  assert.match(gatedPick.description, /licence-gated/);
  assert.match(gatedPick.detail, /Tier: C/);
  assert.equal(ordinaryPick.picked, true);
  assert.deepEqual(
    consented.map((row) => row.name),
    ["ninja"],
    "accepting the screen as shown must not fetch the tier C artifact",
  );
});

test("a producer tier B line carries the elevation note", async () => {
  const { mod, shown } = loadAdapter();
  await mod.confirmDependencyInstalls(
    [commandRow("jlink", [step("jlink", { tier: "B" })])],
    "darwin",
  );
  const [pick] = shown[0];
  assert.match(pick.description, /requires elevation/);
  assert.equal(pick.picked, true, "tier B is consented to, not gated");
});

test("Runs: is the command that runs, never the upstream sourceUrl", async () => {
  const { mod, shown } = loadAdapter();
  await mod.confirmDependencyInstalls(
    [
      commandRow("cmake", [
        step("cmake", { tier: "A", sourceUrl: "https://cmake.org/" }),
      ]),
    ],
    "darwin",
  );
  const [pick] = shown[0];
  assert.match(pick.detail, /^Runs: brew install cmake · Tier: A · /);
  assert.doesNotMatch(pick.detail, /cmake\.org/);
});

test("a row with no producer entry says not reported for tier, size and licence", async () => {
  const { mod, shown } = loadAdapter();
  await mod.confirmDependencyInstalls(
    [
      {
        ...commandRow("west", []),
        action: { kind: "fix", fixId: "west", effect: "bootstrap", title: "t" },
      },
    ],
    "darwin",
  );
  const [pick] = shown[0];
  assert.match(
    pick.detail,
    /Tier: not reported · Size: not reported · Licence: not reported$/,
  );
  assert.equal(pick.picked, true);
});

// ---------------------------------------------------------------------------
// The tier gate fails CLOSED on spelling and on unknown words
// ---------------------------------------------------------------------------

test("a tier word is trimmed and upper-cased, so ' c' IS tier C", () => {
  assert.equal(normaliseProvenance({ tier: " c" }).tier, "C");
  assert.equal(normaliseProvenance({ tier: "b\n" }).tier, "B");
  assert.equal(normaliseProvenance({ tier: "  " }).tier, null);
});

for (const tier of ["c", " C", "C ", "D", "x"]) {
  test(`tier ${JSON.stringify(tier)} starts UNCHECKED`, async () => {
    // Arrange -- built straight from the raw word, as a step crossing a JS
    // boundary without `normaliseProvenance` would carry it.
    const { mod, shown } = loadAdapter();
    const row = commandRow("vendor", [
      { tool: "vendor", command: "brew install vendor", provenance: { tier } },
    ]);

    // Act
    const consented = await mod.confirmDependencyInstalls([row], "darwin");

    // Assert
    const [pick] = shown[0];
    assert.equal(pick.picked, false);
    assert.match(pick.description, /check to install/);
    assert.deepEqual(consented, []);
  });
}

for (const tier of ["A", "a", " b "]) {
  test(`tier ${JSON.stringify(tier)} starts checked`, async () => {
    const { mod, shown } = loadAdapter();
    await mod.confirmDependencyInstalls(
      [
        commandRow("tool", [
          { tool: "tool", command: "brew install tool", provenance: { tier } },
        ]),
      ],
      "darwin",
    );
    assert.equal(shown[0][0].picked, true);
  });
}

test("ONE unchecked-tier step unchecks the whole rollup line", () => {
  const [item] = planInstallConsent(
    [
      commandRow("hostPrerequisites", [
        step("cmake", { tier: "A" }),
        step("vendor", { tier: "D" }),
      ]),
    ],
    "darwin",
  );
  assert.equal(item.startsUnchecked, true);
  assert.equal(item.licenceGated, false, "D is not C; it is unknown");
});

// ---------------------------------------------------------------------------
// A tier that is PRESENT but unreadable fails closed (not "not reported")
// ---------------------------------------------------------------------------

for (const tier of [3, ["C"], { level: "C" }, "", "  ", true]) {
  test(`malformed wire tier ${JSON.stringify(tier)} starts UNCHECKED and reads as unreadable`, async () => {
    // Arrange -- through the real normaliser, as the planner builds the step.
    const provenance = normaliseProvenance({ tool: "vendor", tier });
    const row = commandRow("vendor", [
      { tool: "vendor", command: "brew install vendor", provenance },
    ]);
    const { mod, shown } = loadAdapter();

    // Act
    const [item] = planInstallConsent([row], "darwin");
    await mod.confirmDependencyInstalls([row], "darwin");

    // Assert
    assert.equal(provenance.tier, null);
    assert.equal(provenance.tierUnreadable, true);
    assert.equal(item.startsUnchecked, true);
    assert.equal(item.tier, "unreadable");
    assert.equal(shown[0][0].picked, false);
    assert.match(shown[0][0].description, /tier unreadable/);
  });
}

test("an ABSENT or null tier stays checked and 'not reported'", () => {
  for (const entry of [{ tool: "x" }, { tool: "x", tier: null }]) {
    const provenance = normaliseProvenance(entry);
    assert.equal(provenance.tierUnreadable, undefined);
    const [item] = planInstallConsent(
      [commandRow("x", [{ tool: "x", command: "brew install x", provenance }])],
      "darwin",
    );
    assert.equal(item.startsUnchecked, false);
    assert.equal(item.tier, null);
  }
});

const manifestCheck = (status, detail) => ({
  name: "bootstrapManifest",
  status,
  detail,
  scope: "project",
});

const doctorData = (checks, prerequisites) => ({
  checks: [
    {
      name: "hostPrerequisites",
      status: "fail",
      detail: "missing",
      scope: "host",
    },
    ...checks,
  ],
  summary: { pass: 0, warn: 1, fail: 1 },
  missingPrerequisites: prerequisites,
});

test("doctor reports the provenance block unreadable: every null-tier row starts unchecked", () => {
  // Arrange -- tan's own wording for the artifactProvenance arm.
  const data = doctorData(
    [
      manifestCheck(
        "warn",
        "metadata/bootstrap.json was read, but its artifactProvenance block is not readable: x.",
      ),
    ],
    [
      { tool: "cmake", command: "brew install cmake", tier: null },
      { tool: "ninja", command: "brew install ninja", tier: "A" },
    ],
  );

  // Act
  const [cmake, ninja] = rollupOf(plan(data)).action.commands;

  // Assert -- the null tier is unreadable; a readable A is untouched.
  assert.equal(cmake.provenance.tierUnreadable, true);
  assert.equal(ninja.provenance.tierUnreadable, undefined);
  const [item] = planInstallConsent([rollupOf(plan(data))], "darwin");
  assert.equal(item.startsUnchecked, true);
});

test("doctor bootstrapManifest passing leaves a null tier 'not reported' and checked", () => {
  const data = doctorData(
    [manifestCheck("pass", "ok")],
    [{ tool: "cmake", command: "brew install cmake", tier: null }],
  );
  const [item] = planInstallConsent([rollupOf(plan(data))], "darwin");
  assert.equal(item.startsUnchecked, false);
  assert.equal(item.tier, null);
});

// ---------------------------------------------------------------------------
// Duplicate prerequisite entries for one tool: the most restrictive wins
// ---------------------------------------------------------------------------

const dupRow = (...tiers) =>
  plan({
    checks: [{ name: "git", status: "fail", detail: "", scope: "host" }],
    summary: { pass: 0, warn: 0, fail: 1 },
    missingPrerequisites: tiers.map((tier, i) => ({
      tool: "git",
      command: `install git ${i}`,
      tier,
    })),
  }).rows.find((row) => row.name === "git");

for (const [label, tiers, winner] of [
  ["B beats A", ["A", "B"], 1],
  ["B beats A (reverse order)", ["B", "A"], 0],
  ["C beats A and B", ["A", "C", "B"], 1],
  ["unreadable beats A", ["A", 3], 1],
  ["unknown word beats B", ["B", "D"], 1],
  ["tie keeps the first", ["A", "A"], 0],
]) {
  test(`duplicate entries: ${label}`, () => {
    const [only] = dupRow(...tiers).action.commands;
    assert.equal(only.command, `install git ${winner}`);
  });
}
