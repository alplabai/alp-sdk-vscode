// SPDX-License-Identifier: Apache-2.0
//
// The module wizard's `tan scaffold` argv, checked against the pinned tan's own
// recorded surface — for EVERY branch, not just the one a regex can see.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// Until #601 there was no argv to check: `tan scaffold` was re-implemented in
// TypeScript, and nothing in this repo compared the two. The port emitted the
// module README's `## Notes` section and stopped, while tan had grown a
// `## Wiring` section naming the two `CMakeLists.txt` edits without which the
// module is never compiled. A gate over a generator that IS the second copy
// cannot catch that; calling tan is what closes it.
//
// Having called tan, the argv itself becomes the thing to hold — and this file
// is the STRONGER of the two shapes that were available, not the only one. See
// `packages/alp-core/src/wizard/scaffoldArgv.ts` for the trade: three
// duplicated literals at three call sites would have reduced to
// `resolution: "partial"`; one pure function enumerated here reduces every
// branch to `"full"` and adds the arity, stray-positional and dangling-value
// assertions a partial record does not carry. The price is that the single call
// site reduces to `resolution: "none"`, which every membership assertion in
// `test/tan.surfaceContract.test.js` skips — so the site is pinned by name in
// its `EXPECTED_UNRESOLVABLE` list and checked here instead.
//
// ── What this file does NOT claim ───────────────────────────────────────────
//
// It says every flag exists, is live, and carries the arity it declares. It
// does not say the CALL is correct — a legal argv that omits a required flag is
// invisible here for the same reason it is invisible to the static gate. The
// rule `--force` actually serves (it is only ever reached through a confirm
// that names the files being replaced) is not a property of the argv at all,
// and is pinned in `test/wizard.scaffoldFlow.test.js`, which drives the real
// command.

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
  planScaffoldArgv,
} = require("../packages/alp-core/dist/wizard/scaffoldArgv.js");
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

/**
 * Every module template id the pinned tan ships, VERBATIM from
 * `tan explain --format json`'s `data.available.moduleTemplates[]` at tan 0.6.0.
 *
 * A table here can go stale, and the wizard no longer reads one — it asks
 * `tan explain` at runtime. These are branch inputs, not a catalogue: what they
 * buy is that the argv is exercised with the ids that actually reach it.
 */
const TEMPLATE_IDS = [
  "sensor-driver",
  "connectivity-service",
  "inference-stage",
  "diagnostics-check",
];

/** Project roots and module names carry user-chosen text. A path with a space
 *  and a name with punctuation, because an argv array is not a shell string and
 *  tan normalizes the name itself (measured: `My Sensor!! 2` -> `my_sensor_2`). */
const PROJECT_ROOTS = ["/Users/someone/Alp Projects/probe-rig", "/w"];
const MODULE_NAMES = ["probesens", "My Sensor!! 2", "-"];

/** Every branch of `planScaffoldArgv`, crossed with the real ids. */
function buildMatrix() {
  const cases = [];
  for (const projectRoot of PROJECT_ROOTS) {
    for (const templateId of TEMPLATE_IDS) {
      for (const moduleName of MODULE_NAMES) {
        for (const preview of [true, false]) {
          for (const force of [true, false]) {
            cases.push({
              label:
                `${templateId} "${moduleName}" in ${projectRoot}` +
                `${preview ? " +preview" : ""}${force ? " +force" : ""}`,
              input: { projectRoot, templateId, moduleName, preview, force },
            });
          }
        }
      }
    }
  }
  return cases;
}

const MATRIX = buildMatrix();

function reducedCases() {
  return MATRIX.map((entry) => {
    const argv = planScaffoldArgv(entry.input);
    return { ...entry, argv, record: reduceLiteralArgv(argv, metavars) };
  });
}

const at = (entry) => `${entry.label}\n    tan ${entry.argv.join(" ")}`;

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
    SNAPSHOT.commands?.scaffold,
    `${SNAPSHOT_REL} has no \`scaffold\` command at all — every assertion ` +
      "below would pass vacuously.",
  );
});

// ---------------------------------------------------------------------------
// 2. Every branch reduces to `tan scaffold`, fully
// ---------------------------------------------------------------------------

test("every wizard branch sends `tan scaffold` and nothing but literals", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    if (entry.record.command !== "scaffold") {
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
// 3. Every flag exists on `tan scaffold`
// ---------------------------------------------------------------------------

test("every flag the wizard sends is accepted by `tan scaffold`", () => {
  const options = SNAPSHOT.commands.scaffold.options ?? {};
  const offenders = [];
  for (const entry of reducedCases()) {
    for (const flag of entry.record.flags) {
      if (Object.prototype.hasOwnProperty.call(options, flag)) continue;
      if (GLOBAL_OPTIONS.has(flag)) continue;
      offenders.push(
        `${at(entry)}\n    \`${flag}\` is not an option of \`tan scaffold\` ` +
          `in tan ${SNAPSHOT.version}, and is not a global option`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these flags do not exist at this pin. click exits 2 with `No such " +
      "option` and prints NO envelope, so the wizard reports a generic " +
      "failure with nothing the customer can act on.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 4. No flag is accepted-but-inert
// ---------------------------------------------------------------------------

test("no flag the wizard sends is inert at this pin", () => {
  const options = SNAPSHOT.commands.scaffold.options ?? {};
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
    "an inert flag exits 0 and tells the caller nothing. For `--preview` " +
      "that would mean the plan pass WRITING the module, with the confirm " +
      "still unanswered.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 5. Arity: no stray positional, no dangling value-flag
// ---------------------------------------------------------------------------

test("the wizard sends no positional `tan scaffold` does not take", () => {
  const max = SNAPSHOT.commands.scaffold.maxPositionals ?? 0;
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
    "`tan scaffold` takes no positional arguments. An extra one exits 2 " +
      "with `Got unexpected extra argument(s)` and no envelope, so the " +
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

test("--project always carries the project root, never left to the spawn's cwd", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const index = entry.argv.indexOf("--project");
    if (index === -1) {
      offenders.push(`${at(entry)}\n    --project absent`);
      continue;
    }
    if (entry.argv[index + 1] !== entry.input.projectRoot) {
      offenders.push(
        `${at(entry)}\n    --project ${entry.argv[index + 1]}, expected ` +
          entry.input.projectRoot,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "measured on the pinned tan 0.6.0, a `scaffold` with no `--project` " +
      'answers `project.root: "."` — the spawn\'s cwd, which for an ' +
      "extension-host child is whatever directory VS Code inherited. That " +
      `writes a module into someone else's tree (#605's class).\n${offenders.join("\n")}`,
  );
});

test("--name carries the customer's text VERBATIM, normalized by tan and not here", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const index = entry.argv.indexOf("--name");
    if (entry.argv[index + 1] === entry.input.moduleName) continue;
    offenders.push(
      `${at(entry)}\n    --name ${JSON.stringify(entry.argv[index + 1])}, ` +
        `expected ${JSON.stringify(entry.input.moduleName)}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "normalizing on this side would be a second copy of a rule tan owns — " +
      "the same second copy that shipped a module which never compiled. tan " +
      "reports both spellings back as `moduleName` and " +
      `\`normalizedModuleName\`.\n${offenders.join("\n")}`,
  );
});

test("--preview and --force appear exactly when the input says so", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    const hasPreview = entry.argv.includes("--preview");
    const hasForce = entry.argv.includes("--force");
    if (hasPreview !== entry.input.preview) {
      offenders.push(
        `${at(entry)}\n    --preview ${hasPreview}, input says ${entry.input.preview}`,
      );
    }
    if (hasForce !== entry.input.force) {
      offenders.push(
        `${at(entry)}\n    --force ${hasForce}, input says ${entry.input.force}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "`--force` REPLACES a file whose contents differ, with no diff and no " +
      "backup (measured). A planner that adds it on its own would destroy a " +
      `customer's edits behind a confirm that never mentioned them.\n${offenders.join("\n")}`,
  );
});

test("--non-interactive is on every branch", () => {
  const offenders = [];
  for (const entry of reducedCases()) {
    if (entry.argv.includes("--non-interactive")) continue;
    offenders.push(at(entry));
  }
  assert.deepEqual(
    offenders,
    [],
    "this spawns behind a QuickPick and a modal with no stdin attached: a " +
      `CLI prompt hangs the spawn instead of failing it.\n${offenders.join("\n")}`,
  );
});
