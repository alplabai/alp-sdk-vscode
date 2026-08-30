// SPDX-License-Identifier: Apache-2.0
//
// `cli.parse-error` — what tan answers when it does not accept the argv the
// EXTENSION sent. Measured against the pinned 0.6.0:
//
//   $ tan presets --nosuchflag --format json   # exit 2
//   {"command":"cli","ok":false,"exitCode":2,...,
//    "issues":[{"code":"cli.parse-error","severity":"error",
//               "message":"Usage: tan presets [OPTIONS]\n...╭─ Error ─...╯"}]}
//
// Two things are wrong with that reaching a customer unclassified:
//
//  1. Exit 2 is OVERLOADED. A genuine `tan validate` rejection of board.yaml
//     also exits 2, so `classifyExitCode` maps both onto `"validation"` and
//     `classifyOutcome` therefore grades a parse error `"warning"`. But the
//     project is fine here — the extension and the CLI disagree about the
//     command surface, which is an extension/CLI skew defect, not something
//     the customer did.
//  2. The issue MESSAGE is a click/rich usage dump, box-drawing characters and
//     all. `looksRaw` (src/notify/service.ts) tested only for an errno, an exit
//     code or a stack frame — the box has none of those — so the whole block
//     was interpolated verbatim into `NotificationPlan.message`, whose contract
//     (src/notify/models.ts) is "no raw stderr".
//
// The confusable case has to stay distinguishable, and is pinned below: a real
// exit-2 validation failure keeps its warning severity and keeps tan's own
// sentence as the customer message. Only `cli.parse-error` is re-routed.

const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyOutcome } = require("../out/alpCli/service.js");
const { planCliOutcome } = require("../out/notify/service.js");

/** The measured 0.6.0 payload, verbatim — box-drawing characters kept. */
const USAGE_DUMP =
  "Usage: tan presets [OPTIONS]\n" +
  "Try 'tan presets --help' for help.\n" +
  "╭─ Error ──────────────────────────────────────────────────────────────────────╮\n" +
  "│ No such option: --nosuchflag                                                 │\n" +
  "╰──────────────────────────────────────────────────────────────────────────────╯";

function parseErrorEnvelope() {
  return {
    command: "cli",
    ok: false,
    exitCode: 2,
    project: { root: null, boardYaml: null },
    data: { message: USAGE_DUMP },
    issues: [
      { code: "cli.parse-error", severity: "error", message: USAGE_DUMP },
    ],
  };
}

/** A REAL exit-2 validation failure, for the must-stay-distinguishable case. */
function validationEnvelope() {
  return {
    command: "validate",
    ok: false,
    exitCode: 2,
    project: { root: ".", boardYaml: "/w/board.yaml" },
    data: {},
    issues: [
      {
        code: "validate.sdk-root-unresolved",
        severity: "error",
        message:
          "alp-sdk root is unresolved. Use --sdk-root, place the project near an alp-sdk checkout, or set ALP_SDK_ROOT.",
      },
    ],
  };
}

test("a cli.parse-error is an error, not a validation warning", () => {
  const outcome = classifyOutcome(2, parseErrorEnvelope());
  assert.equal(
    outcome.severity,
    "error",
    "tan rejected the argv the extension sent — grading that a warning puts " +
      "an extension defect in the same bucket as a bad board.yaml",
  );
  // `kind` is deliberately UNCHANGED. src/debug.ts keys its "run Alp: Update
  // CLI" skew hint on `outcome.kind === "validation"` together with `--core` /
  // `--pre-launch-task` on the argv, and an unrecognised flag on a stale tan is
  // exactly this envelope. Retyping the kind would silently kill that hint.
  assert.equal(outcome.kind, "validation");
});

test("a real validation failure keeps its warning severity", () => {
  const outcome = classifyOutcome(2, validationEnvelope());
  assert.equal(
    outcome.severity,
    "warning",
    "board.yaml the customer can fix must not be raised to an error",
  );
});

test("the click usage dump never reaches the customer sentence", () => {
  const plan = planCliOutcome(classifyOutcome(2, parseErrorEnvelope()), {
    operation: "Reading the SDK catalogue",
  });

  assert.doesNotMatch(
    plan.message,
    /Usage:/,
    `the usage dump leaked into the toast — ${plan.message}`,
  );
  assert.doesNotMatch(
    plan.message,
    /[╭╰│─]/,
    `box-drawing characters leaked into the toast — ${plan.message}`,
  );
  assert.match(
    plan.message,
    /Reading the SDK catalogue/,
    "the sentence must still say which operation failed",
  );
  assert.equal(plan.severity, "error");
});

test("the dump is kept, on the channel-only detail", () => {
  const plan = planCliOutcome(classifyOutcome(2, parseErrorEnvelope()), {
    operation: "Reading the SDK catalogue",
  });
  assert.ok(plan.detail, "the dump must be logged, not discarded");
  assert.match(
    plan.detail,
    /No such option: --nosuchflag/,
    "the one line that names the actual argv problem must survive to the " +
      '"Alp SDK" output channel',
  );
});

test("a parse error offers the remedy for CLI-shape skew", () => {
  const plan = planCliOutcome(classifyOutcome(2, parseErrorEnvelope()), {
    operation: "Reading the SDK catalogue",
  });
  const ids = plan.actions.map((a) => a.id);
  assert.ok(
    ids.includes("updateCli"),
    `the extension and the CLI disagree on the command surface, so the fix is ` +
      `a CLI update — actions were ${JSON.stringify(ids)}`,
  );
});

test("a real validation failure still shows tan's own sentence", () => {
  const plan = planCliOutcome(classifyOutcome(2, validationEnvelope()), {
    operation: "Validating board.yaml",
  });
  assert.match(plan.message, /alp-sdk root is unresolved/);
  assert.equal(plan.severity, "warning");
});
