// SPDX-License-Identifier: Apache-2.0
//
// `tan generate --all` runs MORE targets than this extension has a catalog
// entry for, and reporting a failure must survive that.
//
// THE DEFECT THIS GATE EXISTS FOR. `src/loader.ts` used to build the failure
// sentence with
//
//     data.failed.map((emit) => getGenerationTargetSupport(emit as EmitMode).displayName)
//
// and `getGenerationTargetSupport` THROWS on an id it does not know. Measured
// against the pinned tan 0.6.0: `generate --all` runs NINE targets
//
//     zephyr-conf dts-overlay native-sim-overlay cmake-args yocto-conf
//     carrier-netlist west-libraries hw-info-h os-topology
//
// while `GENERATION_TARGET_CATALOG` holds SIX. tan's `explain` reports a TENTH
// it can generate, `zephyr-board`, which `--all` does not run — so the id set
// this extension must survive is the REPORTED ten, not the nine, and that is
// the set the corpus carries and this file iterates. So any board-model-level error —
// an unknown peripheral, an unresolvable SoM SKU, a library scoped to a core
// that is not declared — fails eight of the nine at once, three of which the
// catalog cannot name, and the command handler throws before rendering
// anything. The user gets VS Code's unbranded "Running the contributed command:
// 'alp.generateAll' failed" instead of the toast that carries "Open board.yaml"
// and "Run Doctor".
//
// `src/loader.ts`'s own header already states the rule this violated, verbatim
// (no line number: it moves) — "a `tan` that omits a list must not throw a
// TypeError out of the
// command handler — that surfaces as VS Code's own unbranded 'command failed'
// popup with the raw error, which is worse than any bad toast."
//
// THE `as EmitMode` CAST IS THE MECHANISM. `GenerateData.failed` is correctly
// `string[]`; the cast is what let a `string` back into a function whose domain
// is the six-member union. Narrow, never cast.
//
// WHY THIS IS NOT FIXED BY ADDING THREE CATALOG ENTRIES. It was tried, once, for
// exactly one id: `carrier-netlist`'s entry in `GENERATION_TARGET_CATALOG` says
// so out loud — "Listed here so the shared support lookup never throws when
// `generate --all` reports it among `failed`". That fix has to be repeated every
// time tan adds a target, and it was not: the CLI went to nine and the catalog
// stayed at six. A catalog entry also claims more than a display name — it
// carries `outputRelativePath` and `preview`, i.e. that this extension can
// generate that target on its own, which it cannot. So the reporting path
// degrades to the raw id instead, and the catalog stays a statement about what
// the extension generates rather than about what tan runs.
//
// WHERE THE ID LIST COMES FROM. `test/golden/tan-contract/envelope-contract.json`
// — the recorded envelope corpus for the pinned tan, refreshed by
// `pnpm run contract:fetch`. Its `explain-overview` envelope carries
// `data.available.generationTargets`, which is tan's own answer to "what can you
// generate", and is therefore the list this extension must survive. It moves
// when the pin moves; a hardcoded copy here would not.
//
// A FRESH WORKTREE FAILS THIS FILE UNTIL `pnpm run contract:fetch` HAS RUN. The
// corpus is gitignored, exactly like `test/tanContract.test.js`'s.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CORPUS_REL = "test/golden/tan-contract/envelope-contract.json";

const {
  describeGenerationTarget,
  describeGenerationFailure,
  getGenerationTargetSupport,
} = require("../packages/alp-core/dist/loader/service.js");

/** Every id the pinned tan says it can generate. */
function recordedTargets() {
  const corpusPath = path.join(ROOT, CORPUS_REL);
  if (!fs.existsSync(corpusPath)) {
    throw new Error(
      `${CORPUS_REL} is missing. It is gitignored and fetched — run ` +
        "`pnpm run contract:fetch` before this suite. A fresh worktree fails " +
        "here for that reason and no other.",
    );
  }
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const targets =
    corpus?.envelopes?.["explain-overview"]?.envelope?.data?.available
      ?.generationTargets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(
      `${CORPUS_REL} has no ` +
        "`envelopes.explain-overview.envelope.data.available.generationTargets`. " +
        "Every assertion below would pass against an empty list, so this is a " +
        "hard failure rather than a skip — the corpus shape moved.",
    );
  }
  return targets;
}

// ---------------------------------------------------------------------------
// 1. Every target tan can run renders
// ---------------------------------------------------------------------------

test("every generation target the pinned tan runs has a display name", () => {
  const offenders = [];
  for (const emit of recordedTargets()) {
    try {
      const name = describeGenerationTarget(emit);
      if (typeof name !== "string" || name.length === 0) {
        offenders.push(`${emit}: rendered ${JSON.stringify(name)}`);
      }
    } catch (error) {
      offenders.push(`${emit}: threw ${String(error)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these ids come straight out of the pinned tan and this extension cannot " +
      "name them. A throw here is not a bad label — it is an unhandled " +
      `exception out of a palette command.\n${offenders.join("\n")}`,
  );
});

test("an id the catalog knows keeps its human name", () => {
  // Arrange / Act / Assert -- the degradation must not swallow the good case.
  assert.equal(describeGenerationTarget("zephyr-conf"), "Zephyr config");
  assert.equal(describeGenerationTarget("carrier-netlist"), "Carrier netlist");
});

test("an id the catalog does not know degrades to the id itself", () => {
  // Not "unknown", not "": the raw id is what tan prints in its own issues, so
  // it is the one string a user can match between the toast and the channel.
  assert.equal(describeGenerationTarget("west-libraries"), "west-libraries");
  assert.equal(describeGenerationTarget("os-topology"), "os-topology");
});

// ---------------------------------------------------------------------------
// 2. The whole failure sentence, over the real target set
// ---------------------------------------------------------------------------

test("the failure sentence survives every failed-target combination tan can report", () => {
  const targets = recordedTargets();
  const offenders = [];
  // Every prefix, every suffix, and the whole set: an error at board-model
  // level fails everything downstream of it, so the realistic shapes are runs,
  // not single ids.
  const combinations = [
    [],
    ...targets.map((t) => [t]),
    ...targets.map((_, i) => targets.slice(0, i + 1)),
    ...targets.map((_, i) => targets.slice(i)),
  ];
  for (const failed of combinations) {
    try {
      const sentence = describeGenerationFailure({
        targets,
        written: targets.filter((t) => !failed.includes(t)),
        failed,
      });
      if (typeof sentence !== "string" || sentence.length === 0) {
        offenders.push(
          `${JSON.stringify(failed)}: ${JSON.stringify(sentence)}`,
        );
        continue;
      }
      for (const emit of failed) {
        if (!sentence.includes(describeGenerationTarget(emit))) {
          offenders.push(`${JSON.stringify(failed)}: ${emit} not named`);
        }
      }
    } catch (error) {
      offenders.push(`${JSON.stringify(failed)}: threw ${String(error)}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("nothing failed reads as a plain failure, not as `0 of 9`", () => {
  // `envelope.ok === false` with an empty `failed` is a real shape: the run died
  // before any target was attempted. Counting it as a partial success would
  // report "Regenerated 9 of 9 formats — failed." with nothing named.
  assert.equal(
    describeGenerationFailure({
      targets: ["zephyr-conf"],
      written: [],
      failed: [],
    }),
    "Regenerating all formats failed.",
  );
});

test("a partial failure names the counts and every failed target", () => {
  assert.equal(
    describeGenerationFailure({
      targets: ["zephyr-conf", "dts-overlay", "west-libraries"],
      written: ["build/generated/alp.conf"],
      failed: ["dts-overlay", "west-libraries"],
    }),
    "Regenerated 1 of 3 formats — Devicetree overlay, west-libraries failed.",
  );
});

// ---------------------------------------------------------------------------
// 3. The throwing lookup keeps throwing
// ---------------------------------------------------------------------------

// `describeGenerationTarget` must NOT be a softer `getGenerationTargetSupport`.
// The two answer different questions and only one of them may degrade:
// `createLoaderPlan` needs `outputRelativePath` and cannot invent one, so an id
// it does not know is a programming error and must stay loud.
test("the plan-building lookup still refuses an id it cannot build", () => {
  assert.throws(
    () => getGenerationTargetSupport("west-libraries"),
    /unsupported generation target/,
    "softening this would make `alp.generate <target>` write to an undefined " +
      "path instead of failing",
  );
});
