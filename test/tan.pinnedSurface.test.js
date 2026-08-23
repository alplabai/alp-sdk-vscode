// SPDX-License-Identifier: Apache-2.0
//
// `src/alpCli/pinnedSurface.ts` re-declares two capability facts about the
// pinned tan, in `src/`, where the shipped extension can read them. This file
// holds those declarations to `test/golden/tan-surface/surface.json` — the
// pinned binary's own `--help`, recorded.
//
// WHY A SECOND COPY EXISTS AT ALL. The recording is a test fixture and `test/`
// is not in the VSIX, so a shipped panel cannot consult it. The product needs
// the fact at runtime; the recording is the authority. Same shape as the
// vendored board schemas (`packages/alp-core/src/validation/vendoredSchemas.ts`
// and its gates): a runtime constant, and a gate that fails when it stops
// describing the artefact it was copied from.
//
// WHAT IT PROTECTS, AND IT IS BOTH DIRECTIONS.
//
// A capability that DISAPPEARS is the obvious one: `tan model` losing `build`,
// or `--materialise` becoming inert, would leave the panels spawning argv the
// CLI no longer honours. `test/tan.surfaceContract.test.js` catches that class
// already, because those calls are still written in `src/`.
//
// A capability that ARRIVES is the one only this file can catch, and it is the
// direction #522/#523 was actually about. Once a call is no longer made, the
// surface contract has nothing to check: `tan model list` implemented upstream
// would leave the Models panel reporting a gap that CLOSED, forever, and the
// gate that reads argv would stay green because there is no argv. The alarm is
// derived from these constants now, so these constants are what has to fail.
//
// The message on each assertion names the file to rewire, because "the pin
// moved" is a fact anyone can read off assertion 1 of the surface contract and
// "so the Models panel must spawn again" is not.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_REL = "test/golden/tan-surface/surface.json";

const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, SNAPSHOT_REL), "utf8"),
);

const {
  MODEL_SUBCOMMANDS,
  MODEL_UNKNOWN_SUBCOMMAND_CODE,
  MODEL_SURFACE_REF,
  DEFERRED_BUILD_OPTIONS,
  BUILD_DEFERRED_REF,
  MODEL_SUBCOMMAND_UNWIRED_CODE,
  INERT_OPTIONS,
  inertKindOf,
  isBuildOptionDeferred,
  isModelSubcommandImplemented,
  unsupportedModelSubcommand,
  deferredBuildOptionMessage,
} = require("../out/alpCli/pinnedSurface.js");

const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

// The whole file rests on the recording describing the binary we pin. The
// surface contract asserts this first for the same reason; repeated here
// because these constants are read by the SHIPPED extension, so a snapshot
// from some other tan would certify a runtime claim rather than a test one.
test("the vendored surface this file reads was captured from the pinned tan", () => {
  assert.equal(
    SNAPSHOT.version,
    SUPPORTED_CLI_VERSION,
    `${SNAPSHOT_REL} records tan ${SNAPSHOT.version} but SUPPORTED_CLI_VERSION ` +
      `is ${SUPPORTED_CLI_VERSION}. Re-capture it with ` +
      "`node scripts/tan-surface/fetch.mjs` against the newly pinned binary.",
  );
});

// ---------------------------------------------------------------------------
// `tan model`
// ---------------------------------------------------------------------------

test("MODEL_SUBCOMMANDS is exactly what the pinned tan implements", () => {
  assert.deepEqual(
    [...MODEL_SUBCOMMANDS].sort(),
    [...(SNAPSHOT.commands.model?.subcommandValues ?? [])].sort(),
    "`src/alpCli/pinnedSurface.ts` and the recorded `--help` disagree about " +
      "which `tan model` subcommands exist.\n\n" +
      "If a subcommand ARRIVED: `src/models/panel.ts` is still reporting it " +
      "as unavailable and spawning nothing for it. Give that handler its " +
      '`runAlpCommand(["model", <verb>, …])` back, then add the verb here. ' +
      "The Models surface is hidden on `dev` (#525) — re-exposing it is #524, " +
      "and a hidden panel reporting a stale gap is still a stale gap.\n\n" +
      "If one LEFT: the handler that still spawns it must stop.",
  );
});

test("`build` is implemented, and the panel spawns exactly it", () => {
  // The control under the assertion above: an empty snapshot and an empty
  // constant compare equal, and every derived alarm would then fire on a CLI
  // that implements everything.
  assert.equal(
    isModelSubcommandImplemented("build"),
    true,
    "`tan model build` is the ONE subcommand this pin implements — if this " +
      "is false, either the recording is empty or the constant is",
  );
  for (const verb of ["list", "doctor", "check", "zoo", "add", "prep", "run"]) {
    assert.equal(
      isModelSubcommandImplemented(verb),
      false,
      `\`tan model ${verb}\` is not implemented at this pin (${MODEL_SURFACE_REF})`,
    );
  }
});

test("`tan model` has no `--model` option, which is why per-model build is not expressible", () => {
  // #543's other half. `buildModel` used to send `["model", "build",
  // "--model", name]`; click exits 2 with `No such option` and prints no
  // envelope, so the refusal arrived as a bare failure.
  assert.equal(
    SNAPSHOT.commands.model?.options?.["--model"],
    undefined,
    "the recording now shows a `--model` option on `tan model`. Per-model " +
      "selection just became expressible — `src/models/panel.ts`'s " +
      "`buildModel` builds ALL models and says so in its progress line, and " +
      "that explanation is now wrong.",
  );
});

test("the synthesised refusal is the shape the webview classifier reads", () => {
  const outcome = unsupportedModelSubcommand("zoo");

  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, 1);
  assert.ok(outcome.envelope, "a bare outcome carries no `issues` to classify");
  assert.equal(outcome.envelope.command, "model");
  assert.equal(outcome.envelope.ok, false);
  assert.deepEqual(
    outcome.envelope.issues.map((issue) => issue.code),
    [MODEL_UNKNOWN_SUBCOMMAND_CODE],
    "the alarm is DERIVED now rather than probed, so this code is the whole " +
      "of what makes it fire: `findUnsupportedSubcommand` " +
      "(packages/alp-webview/src/features/models/cliSurface.ts) classifies on " +
      "the code and never on the prose",
  );

  const message = outcome.envelope.issues[0].message;
  assert.match(
    message,
    /zoo/,
    "the refusal must name the subcommand asked for",
  );
  assert.ok(
    message.includes(MODEL_SURFACE_REF),
    `the refusal must name ${MODEL_SURFACE_REF} — an issue number is what ` +
      "tells the reader the spelling is right and the CLI is the gap",
  );
  assert.match(
    message,
    new RegExp(SUPPORTED_CLI_VERSION.replace(/[.\-]/g, "\\$&")),
    "and the version it is true of — the customer's next question after " +
      "'not implemented' is 'in what'",
  );
  assert.equal(
    outcome.message,
    message,
    "`cliFailureMessage` reads `outcome.message` for the toast while the " +
      "banner reads the issue; two different sentences for one fact is how a " +
      "customer concludes there are two problems",
  );
});

test("the refusal code is spelled the same here and in the webview classifier", () => {
  // Two copies of one string, in two packages, and only one of them is the
  // classifier. A rename in either that missed the other would leave the
  // banner silent with everything else working.
  const classifier = fs.readFileSync(
    path.join(ROOT, "packages/alp-webview/src/features/models/cliSurface.ts"),
    "utf8",
  );
  assert.match(
    classifier,
    new RegExp(`UNKNOWN_SUBCOMMAND_CODE = "${MODEL_UNKNOWN_SUBCOMMAND_CODE}"`),
    "`packages/alp-webview/src/features/models/cliSurface.ts` no longer " +
      `declares \`${MODEL_UNKNOWN_SUBCOMMAND_CODE}\`, so the refusal ` +
      "`src/alpCli/pinnedSurface.ts` synthesises reaches a classifier looking " +
      "for a different code and the capability banner never renders",
  );
});

// ---------------------------------------------------------------------------
// `tan build`'s deferred flags
// ---------------------------------------------------------------------------

test("every flag DEFERRED_BUILD_OPTIONS names is recorded inert, under tan-cli#427", () => {
  const options = SNAPSHOT.commands.build?.options ?? {};
  const live = [];
  for (const flag of DEFERRED_BUILD_OPTIONS) {
    const option = options[flag];
    assert.ok(option, `\`tan build ${flag}\` is not an option at this pin`);
    if (option.inert !== true) live.push(flag);
    else {
      assert.equal(
        option.ref,
        BUILD_DEFERRED_REF,
        `\`${flag}\` is inert under ${option.ref}, not ${BUILD_DEFERRED_REF} — ` +
          "the message the panel prints names the wrong issue",
      );
    }
  }
  assert.deepEqual(
    live,
    [],
    "these flags are LIVE now.\n\n" +
      "`src/ideHub/buildPlanPanel.ts` reports them as deferred and spawns " +
      "nothing for them (#541). Restore the spawn and its " +
      "`checkTanPayload(...)` shape check — the payload can arrive again, so " +
      "the panel can crash on it again — and put the call-site tests back in " +
      "test/tanPayloadShape.test.js, which lost two of three when the spawns " +
      "went.",
  );
});

test("the flags this panel still spawns are NOT inert", () => {
  // The control. A blanket `inert: true` — or a DEFERRED_BUILD_OPTIONS that
  // grew to cover everything — would pass the assertion above and quietly turn
  // the two working buttons into notices.
  const options = SNAPSHOT.commands.build?.options ?? {};
  for (const flag of ["--materialise", "--plan-from"]) {
    assert.equal(
      options[flag]?.inert,
      false,
      `\`tan build ${flag}\` is live at this pin and the panel depends on it`,
    );
    assert.equal(
      DEFERRED_BUILD_OPTIONS.includes(flag),
      false,
      `\`${flag}\` must not be listed as deferred — the Materialise button ` +
        "would become a notice about a flag that works",
    );
  }
});

test("the deferred message says at least what the CLI's own refusal said", () => {
  // The regression bar, stated as an assertion rather than as a hope. tan's
  // own text, measured: "`tan build --plan` is deferred and not available in
  // this build (see https://github.com/alplabai/tan-cli/issues/427)."
  const message = deferredBuildOptionMessage("--plan");
  assert.match(message, /tan build --plan/, "the flag, as a command line");
  assert.match(message, /deferred/);
  assert.match(message, /tan-cli#427/);
  assert.match(
    message,
    /https:\/\/github\.com\/alplabai\/tan-cli\/issues\/427/,
    "the URL tan itself printed — the reader must not have to reconstruct it " +
      "from the issue reference",
  );
  assert.match(
    message,
    new RegExp(SUPPORTED_CLI_VERSION.replace(/[.\-]/g, "\\$&")),
    "and the version, which tan's own refusal did NOT say",
  );
  assert.match(
    message,
    /Nothing was run/i,
    "the one thing the CLI could not say: there is no failed subprocess to " +
      "go looking for in the output channel",
  );
});

// ---------------------------------------------------------------------------
// The constants DECIDE, they are not merely snapshot-checked
// ---------------------------------------------------------------------------
//
// Both helpers used to ignore their own constant. `unsupportedModelSubcommand`
// synthesised "not implemented in tan <version> (tan-cli#857)" for whatever
// verb it was handed, and `deferredBuildOptionMessage` described whatever flag
// it was handed as deferred. So when tan-cli#857 or tan-cli#427 lands and the
// pin moves, the ONLY red is a constant-vs-snapshot compare above, and the
// one-line edit that greens it leaves eight call sites in `models/panel.ts`
// and two in `buildPlanPanel.ts` telling the customer a capability is missing
// from a binary that has it. A gate that changes only a test when the world
// changes is a gate that gets edited, not read.
//
// These pin the OTHER direction: the value of the constant reaches behaviour.

test("a `model` verb this pin DOES implement is not described as missing", () => {
  // `build` is the one. Nothing calls `unsupportedModelSubcommand("build")`
  // today — `buildModel` spawns it for real — which is exactly why this has to
  // be asserted rather than observed: it is the shape EVERY verb takes the day
  // tan-cli#857 lands, and there would be nothing red to notice it by.
  assert.ok(
    isModelSubcommandImplemented("build"),
    "the fixture verb for this test must actually be implemented at the pin",
  );
  const outcome = unsupportedModelSubcommand("build");

  assert.doesNotMatch(
    outcome.message,
    /is not implemented/,
    "a verb the pinned binary HAS must never be reported as one it lacks — " +
      "that sentence would be false about the tan the customer is running, " +
      "and produced by the pin bump that made it false",
  );
  assert.doesNotMatch(
    outcome.message,
    /tan-cli#857/,
    "and it must not cite the upstream issue for a gap that is closed",
  );
  assert.match(
    outcome.message,
    /IS implemented/,
    "it says what is actually true: the capability is there",
  );
  assert.match(
    outcome.message,
    /#524/,
    "and names the gap that is real — this panel has no call for it",
  );
  assert.equal(
    outcome.envelope.issues[0].code,
    MODEL_SUBCOMMAND_UNWIRED_CODE,
    "NOT `model.unknown-subcommand`: that is tan's verdict for a subcommand " +
      "the binary does not have, and the webview raises its capability " +
      "banner on it. Sending it about a CLI that CAN do the thing is the " +
      "wrong diagnosis wearing the producer's own code",
  );
  assert.equal(
    outcome.envelope.issues.length,
    1,
    "still exactly one issue — `toModelsData` adds nothing of its own when " +
      "the envelope is non-null, so an empty list is `ok: false` with no " +
      "banner at all",
  );
});

test("a `model` verb this pin does NOT implement still reports the gap", () => {
  // The direction that must not regress while fixing the other one.
  const outcome = unsupportedModelSubcommand("zoo");
  assert.match(outcome.message, /is not implemented/);
  assert.equal(
    outcome.envelope.issues[0].code,
    "model.unknown-subcommand",
    "tan's own code, so the webview's one capability banner still lights",
  );
});

test("a `build` flag this pin does NOT defer is not described as deferred", () => {
  // `--materialise` is live at this pin and this panel spawns it. It is one
  // typo away from `deferredBuildOptionMessage`, and the day tan-cli#427 lands
  // all three currently-deferred flags become exactly this case while
  // `buildPlanPanel.ts` still passes their names.
  assert.equal(
    isBuildOptionDeferred("--materialise"),
    false,
    "the fixture flag for this test must actually be live at the pin",
  );
  const message = deferredBuildOptionMessage("--materialise");

  assert.match(message, /NOT deferred/);
  assert.doesNotMatch(
    message,
    /tan-cli#427/,
    "citing the upstream deferral issue for a flag that is not deferred " +
      "blames the CLI for a gap that is this panel's",
  );
  assert.match(
    message,
    /#541/,
    "and it names the gap that IS real — the panel does not send it",
  );
});

test("a `build` flag this pin DOES defer still reads as deferred", () => {
  for (const flag of DEFERRED_BUILD_OPTIONS) {
    assert.match(deferredBuildOptionMessage(flag), /is deferred in tan/, flag);
  }
});

// ---------------------------------------------------------------------------
// inert options, and the kind of inertness each one is
// ---------------------------------------------------------------------------

/** Every `"<command> <flag>"` the recording marks inert. */
function recordedInertOptions() {
  const found = [];
  for (const [command, spec] of Object.entries(SNAPSHOT.commands ?? {})) {
    for (const [flag, option] of Object.entries(spec.options ?? {})) {
      if (option?.inert === true) found.push(`${command} ${flag}`);
    }
  }
  return found.sort();
}

test("every inert option in the recording is classified, and nothing else is", () => {
  // BOTH directions, and the second one is the point. `INERT_OPTIONS` is read
  // by the shipped extension, so an entry that stops being inert makes the
  // product describe a working flag as dead — and an inert option MISSING from
  // the table gets `inertKindOf() === null`, which every consumer reads as
  // "live". That direction fails open and silently, which is how nine deferred
  // `build` flags came to be described to the customer as flags that work.
  assert.deepEqual(
    Object.keys(INERT_OPTIONS).sort(),
    recordedInertOptions(),
    "src/alpCli/pinnedSurface.ts's INERT_OPTIONS and the recording disagree " +
      "about which options are inert.\n\n" +
      "An option that became LIVE: drop its entry, and check whether a panel " +
      "should now spawn the call it has been refusing.\n" +
      "An option that became INERT: add it with its kind — `deferred` ONLY if " +
      "the recording's `ref` names an upstream issue tracking its arrival. " +
      "`compatibility`, `parity` and `not-applicable` are permanent, and a " +
      '"not yet" sentence about them promises an arrival that is not coming.',
  );
});

test("a `deferred` classification is backed by the recording's own upstream ref", () => {
  // The kinds are declared, not derived — but `deferred` is the one kind that
  // makes a promise, so it is the one the recording can still check. Every
  // other kind is permanent and has no ref to check against.
  for (const [key, kind] of Object.entries(INERT_OPTIONS)) {
    if (kind !== "deferred") continue;
    const [command, flag] = key.split(" ");
    assert.equal(
      SNAPSHOT.commands?.[command]?.options?.[flag]?.ref,
      BUILD_DEFERRED_REF,
      `\`tan ${key}\` is classified deferred, but the recording does not put ` +
        `it under ${BUILD_DEFERRED_REF} — the message names an issue that is ` +
        "not the one tracking its arrival",
    );
  }
});

test("the classification is not vacuous: all four kinds are present", () => {
  const kinds = new Set(Object.values(INERT_OPTIONS));
  assert.deepEqual(
    [...kinds].sort(),
    ["compatibility", "deferred", "not-applicable", "parity"],
    "a table that had collapsed to one kind would pass every assertion above " +
      "while telling the customer the same thing about all 17 options",
  );
});

test("the three flags the Build Plan panel sends are deferred, not merely inert", () => {
  // DEFERRED_BUILD_OPTIONS is the panel's list; INERT_OPTIONS is the binary's.
  // This is where the two must agree, and where a `--plan` reclassified as
  // `compatibility` (never arriving) would have to change #541's plan rather
  // than pass quietly.
  for (const flag of DEFERRED_BUILD_OPTIONS) {
    assert.equal(inertKindOf("build", flag), "deferred", flag);
    assert.equal(isBuildOptionDeferred(flag), true, flag);
  }
});
