// SPDX-License-Identifier: Apache-2.0
//
// The New Project wizard's `tan init` argv, checked against the pinned tan's
// own recorded surface — for EVERY branch, not just the one a regex can see.
//
// ── The hole this closes ────────────────────────────────────────────────────
//
// `test/tan.surfaceContract.test.js` checks every `tan` argv this extension
// sends, and it did not check a single one of the wizard's. All five of the
// panel's call sites reduced to `resolution: "none"` in
// `scripts/tan-surface/extract.mjs` — four opened with a conditional spread
// (`[...root, "explain"]`), and the `init` argv was assembled into a variable
// by a ternary plus four conditional `.push()` calls, which is not an
// `ArrayLiteralExpression` at the call site and so cannot be read at all.
// A `"none"` record is skipped by all five assertions there. It was pinned by
// name in `EXPECTED_UNRESOLVABLE`, which says the hole exists; it does not
// fill it.
//
// That is not hypothetical. The wizard shipped `init.invalid-cores` on six of
// eleven SoMs (#528/#529) and 12 refused template x SoM pairs (#530), and BOTH
// were found by hand. The four spread sites are now literal-first
// (`["explain", ...root]`), which the static gate reads as `partial`. The
// `init` argv cannot be made literal — it is genuinely conditional — so it
// moved into `packages/alp-core/src/project/initArgv.ts` as a pure function
// and is ENUMERATED here instead.
//
// ── Same rules, not a second copy of them ───────────────────────────────────
//
// The reduction comes from the extractor itself (`reduceLiteralArgv`), so a
// flag's arity is read from the snapshot's `metavar` exactly as it is for a
// static site. That matters: without it `["init", "--som", "E1M-AEN801"]`
// counts the SKU as a stray positional and this file would report a defect
// that is not there (#543). The snapshot is the same committed file, and
// assertion 1 below refuses to run against one captured from a different tan.
//
// ── What this file does NOT claim ───────────────────────────────────────────
//
// It says every flag exists, is live, and carries the arity it declares. It
// does not say the CALL is correct — a legal argv that omits a required flag
// is invisible here for the same reason it is invisible to the static gate
// (`tan flash` without `--confirm` is the standing example, #540). It also
// says nothing about which template x SoM pairs tan will accept: that is a
// per-template tree only `tan explain`'s prose reports (tan-cli#866), and the
// panel classifies those refusals at runtime through `classifyInitRefusal`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_REL = "test/golden/tan-surface/surface.json";
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, SNAPSHOT_REL), "utf8"),
);
const GLOBAL_OPTIONS = new Set(SNAPSHOT.globalOptions ?? []);

const {
  planInitArgv,
} = require("../packages/alp-core/dist/project/initArgv.js");
const {
  planInitCores,
} = require("../packages/alp-core/dist/project/initCores.js");
const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

// The extractor is ESM and this file is CJS, so the reducer arrives through a
// dynamic import resolved once, before any test body runs.
let reduceLiteralArgv;
let metavars;
test.before(async () => {
  const extractor = await import("../scripts/tan-surface/extract.mjs");
  reduceLiteralArgv = extractor.reduceLiteralArgv;
  metavars = extractor.loadMetavars(path.join(ROOT, SNAPSHOT_REL), {
    allowMissing: false,
  });
});

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/**
 * Every SoM's declared topology, VERBATIM from `tan presets --format json`
 * (`data.soms[].cores[]`) at tan 0.6.0 against SDK v0.16.0-rc1.
 *
 * Real topologies rather than invented ones, because the shape is what broke:
 * six of these eleven declare TWO `os: zephyr` cores, and sending that pair
 * through `--cores` verbatim is exactly the `init.invalid-cores` refusal of
 * #528. An invented single-core fixture would have passed the bug.
 *
 * This table can go stale — nothing regenerates it when a SoM's topology
 * changes upstream, and a stale row silently narrows the matrix rather than
 * failing. It is a BRANCH matrix, not a SoM catalogue:
 * `test/ideHub.projectScaffold.test.js` is what holds the SKU list to the
 * SDK's metadata, and `test/project.initCores.test.js` pins the filter's own
 * answers.
 */
const SOM_TOPOLOGIES = {
  "E1M-AEN301": [
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN401": [
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN501": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN601": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN701": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN801": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-NX9101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33", os: "zephyr" },
  ],
  "E1M-V2M101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2M102": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2N101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2N102": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
};

/** A path with a space in it, because `--destination` and `--from-example`
 *  carry user-chosen paths and an argv array is not a shell string. */
const PARENT_DIR = "/Users/someone/Alp Projects";
const SDK_PATH = "/Users/someone/.alp/sdk/v0.16.0-rc1";

/** Every branch of `planInitArgv`, crossed with every SoM. */
function buildMatrix() {
  const cases = [];
  for (const [moduleId, cores] of Object.entries(SOM_TOPOLOGIES)) {
    for (const sdkPath of [undefined, SDK_PATH]) {
      // Starter template: `--template` + `--som` (+ `--cores` when the SoM has
      // a companion).
      cases.push({
        label: `starter blinky on ${moduleId}${sdkPath ? " +sdk" : ""}`,
        input: {
          templateId: "blinky",
          projectName: "my-project",
          parentDir: PARENT_DIR,
          moduleId,
          cores,
          sdkPath,
        },
      });
      // Example: `--from-example` + `--som`, never `--cores`.
      cases.push({
        label: `example mproc-mailbox on ${moduleId}${sdkPath ? " +sdk" : ""}`,
        input: {
          templateId: "multicore/mproc-mailbox",
          sourceDir: "/sdk/examples/multicore/mproc-mailbox",
          projectName: "my-project",
          parentDir: PARENT_DIR,
          moduleId,
          cores,
          sdkPath,
        },
      });
    }
  }
  // The two degenerate inputs the panel can still produce: an example scaffolded
  // with no SoM chosen (the copied board.yaml keeps its own), and a starter for
  // a SoM whose topology never loaded (`presets` returned nothing, so the
  // built-in `E1M_MODULES` fallback supplies no `cores`).
  cases.push({
    label: "example with no SoM chosen",
    input: {
      templateId: "hello",
      sourceDir: "/sdk/examples/hello",
      projectName: "my-project",
      parentDir: PARENT_DIR,
      moduleId: "",
    },
  });
  cases.push({
    label: "starter with no topology loaded",
    input: {
      templateId: "blinky",
      projectName: "my-project",
      parentDir: PARENT_DIR,
      moduleId: "E1M-AEN801",
      cores: [],
    },
  });
  return cases;
}

const MATRIX = buildMatrix();

/** Every case, planned and reduced. */
function reducedCases() {
  return MATRIX.map((entry) => {
    const plan = planInitArgv(entry.input);
    return { ...entry, plan, record: reduceLiteralArgv(plan.argv, metavars) };
  });
}

const at = (entry) => `${entry.label}\n    tan ${entry.plan.argv.join(" ")}`;

// ---------------------------------------------------------------------------
// 1. The snapshot describes the tan we pin
// ---------------------------------------------------------------------------

// First for the same reason the surface contract asserts it first: every
// assertion below is a claim about a specific binary, and a snapshot captured
// from some other tan would certify nothing.
test("the surface this file checks against was captured from the pinned tan", () => {
  assert.equal(
    SNAPSHOT.version,
    SUPPORTED_CLI_VERSION,
    `${SNAPSHOT_REL} records tan ${SNAPSHOT.version} but SUPPORTED_CLI_VERSION ` +
      `is ${SUPPORTED_CLI_VERSION}. Re-capture it with ` +
      "`node scripts/tan-surface/fetch.mjs` against the newly pinned binary.",
  );
  assert.ok(
    SNAPSHOT.commands?.init,
    `${SNAPSHOT_REL} has no \`init\` command at all — every assertion below ` +
      "would pass vacuously.",
  );
});

// ---------------------------------------------------------------------------
// 2. Every branch reduces to `tan init`, fully
// ---------------------------------------------------------------------------

test("every wizard branch sends `tan init` and nothing but literals", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    if (entry.record.command !== "init") {
      offenders.push(
        `${at(entry)}\n    command reduced to ${JSON.stringify(entry.record.command)}`,
      );
      continue;
    }
    // A planner output is all strings by construction. `full` failing here
    // means the planner grew a hole (an `undefined` spliced into the array),
    // which would reach `spawn` as a real argument.
    if (entry.record.resolution !== "full") {
      offenders.push(
        `${at(entry)}\n    reduced ${entry.record.resolution}, not full`,
      );
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

// ---------------------------------------------------------------------------
// 3. Every flag exists on `tan init`
// ---------------------------------------------------------------------------

test("every flag the wizard sends is accepted by `tan init`", () => {
  const options = SNAPSHOT.commands.init.options ?? {};
  const offenders = [];
  for (const entry of reducedCases()) {
    for (const flag of entry.record.flags) {
      if (Object.prototype.hasOwnProperty.call(options, flag)) continue;
      if (GLOBAL_OPTIONS.has(flag)) continue;
      offenders.push(
        `${at(entry)}\n    \`${flag}\` is not an option of \`tan init\` in ` +
          `tan ${SNAPSHOT.version}, and is not a global option`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these flags do not exist at this pin. click exits 2 with `No such " +
      "option` and prints NO envelope, so the wizard reports a generic " +
      "failure on the Confirm step rather than anything the customer can act " +
      `on.\n${offenders.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// 4. No flag is accepted-but-inert
// ---------------------------------------------------------------------------

test("no flag the wizard sends is inert at this pin", () => {
  const options = SNAPSHOT.commands.init.options ?? {};
  const offenders = [];
  for (const entry of reducedCases()) {
    for (const flag of entry.record.flags) {
      const option = options[flag];
      if (!option || option.inert !== true) continue;
      offenders.push(
        `${at(entry)}\n    \`${flag}\` parses and does NOTHING — ` +
          `${option.ref ?? option.marker ?? "no issue named in the help text"}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an inert flag exits 0 and tells the caller nothing, so the wizard " +
      "reports a project created with a setting that was never applied.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 5. Arity: no stray positional, no dangling value-flag
// ---------------------------------------------------------------------------

test("the wizard sends no positional `tan init` does not take", () => {
  const max = SNAPSHOT.commands.init.maxPositionals ?? 0;
  const offenders = [];
  for (const entry of reducedCases()) {
    if (entry.record.positionalCount <= max) continue;
    offenders.push(
      `${at(entry)}\n    ${entry.record.positionalCount} positionals ` +
        `(${JSON.stringify(entry.record.positionalValues)}), max ${max}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "`tan init` takes no positional arguments. An extra one exits 2 with " +
      "`Got unexpected extra argument(s)` and, again, no envelope — so the " +
      `refusal is structurally unclassifiable (#543).\n${offenders.join("\n")}`,
  );
});

test("no value-taking flag is sent with nothing to take", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    if (entry.record.danglingFlags.length === 0) continue;
    offenders.push(
      `${at(entry)}\n    ${entry.record.danglingFlags.join(", ")} ends the argv`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "a flag whose value is required and absent is refused by click before " +
      `anything runs.\n${offenders.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// 6. The shape rules the flag vocabulary cannot express
// ---------------------------------------------------------------------------

test("--cores carries planInitCores' answer, never the declared topology", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const { argv } = entry.plan;
    const index = argv.indexOf("--cores");
    const expected = entry.input.sourceDir
      ? null // an example brings its own board.yaml; --cores does not apply
      : planInitCores(entry.input.cores ?? []).arg;

    if (expected === null) {
      if (index !== -1) {
        offenders.push(`${at(entry)}\n    --cores sent with nothing to say`);
      }
      continue;
    }
    if (index === -1) {
      offenders.push(`${at(entry)}\n    --cores missing, expected ${expected}`);
      continue;
    }
    if (argv[index + 1] !== expected) {
      offenders.push(
        `${at(entry)}\n    --cores ${argv[index + 1]}, expected ${expected}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "`--cores` splices companions APP-LESS, so an app-less `os: zephyr` " +
      "slice is refused with exit 2 / `init.invalid-cores` — the #528 " +
      `failure, six of eleven SoMs.\n${offenders.join("\n")}`,
  );
});

test("no core is sent with its declared zephyr os", () => {
  // The exact spelling of the #528 defect: `m55_he:zephyr`. Searched for in the
  // OUTPUT rather than in the source, so any route back to it trips this.
  const offenders = [];
  for (const entry of reducedCases()) {
    const zephyrArgs = entry.plan.argv.filter((arg) => /:zephyr\b/.test(arg));
    if (zephyrArgs.length === 0) continue;
    offenders.push(`${at(entry)}\n    ${zephyrArgs.join(", ")}`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("a template and an example are never both requested", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const { argv } = entry.plan;
    const hasTemplate = argv.includes("--template");
    const hasExample = argv.includes("--from-example");
    if (hasTemplate !== hasExample) continue;
    offenders.push(
      `${at(entry)}\n    --template=${hasTemplate} --from-example=${hasExample}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "exactly one source must be named: both is ambiguous, and neither " +
      `scaffolds nothing.\n${offenders.join("\n")}`,
  );
});

test("--sdk-root is sent when and only when the wizard picked an SDK", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const sent = entry.plan.argv.includes("--sdk-root");
    const picked = Boolean(entry.input.sdkPath);
    if (sent === picked) continue;
    offenders.push(`${at(entry)}\n    sent=${sent} picked=${picked}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "sending it unconditionally would pin an empty root; omitting it when " +
      "the user chose one scaffolds an example out of a different SDK than " +
      `the project is pinned to.\n${offenders.join("\n")}`,
  );
});

test("every core the SoM declares as zephyr is reported back to the caller", () => {
  // The planner OMITS every Zephyr core from `--cores` and lets tan pick its
  // own app core, so any core past the app one is absent from the generated
  // board.yaml. Returning the set is what lets the panel say so; losing it
  // hands a dual-M55 customer a single-core project in silence (#528).
  const offenders = [];
  for (const entry of reducedCases()) {
    const declared = entry.input.sourceDir
      ? []
      : (entry.input.cores ?? [])
          .filter((core) => core.os === "zephyr")
          .map((core) => core.id);
    try {
      assert.deepEqual(entry.plan.zephyrCores, declared);
    } catch {
      offenders.push(
        `${at(entry)}\n    reported ${JSON.stringify(entry.plan.zephyrCores)}, ` +
          `declared ${JSON.stringify(declared)}`,
      );
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

// ---------------------------------------------------------------------------
// 7. The gate actually ran
// ---------------------------------------------------------------------------

// Every assertion above is `deepEqual(offenders, [])`, which an empty matrix
// satisfies perfectly. A `buildMatrix` that returns nothing — a renamed field,
// a topology table emptied by a bad edit — turns this whole file green with no
// code change anywhere.
test("the matrix covers every SoM and both scaffold sources", () => {
  const expected = Object.keys(SOM_TOPOLOGIES).length * 2 * 2 + 2;
  assert.equal(
    MATRIX.length,
    expected,
    `${MATRIX.length} cases, expected ${expected} (11 SoMs x starter/example ` +
      "x with/without an SDK, plus the two degenerate inputs). A shrunken " +
      "matrix passes every assertion above without checking anything.",
  );
  const cases = reducedCases();
  assert.ok(
    cases.some((entry) => entry.plan.argv.includes("--cores")),
    "no case produced a `--cores` argument — the flag this file exists for " +
      "is unchecked.",
  );
  assert.ok(
    cases.some((entry) => entry.plan.argv.includes("--from-example")),
    "no case produced an example scaffold.",
  );
});
