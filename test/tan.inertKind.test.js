// SPDX-License-Identifier: Apache-2.0
//
// An inert option is not one thing.
//
// `test/golden/tan-surface/surface.json` records 17 options as `inert: true`
// across 32 commands, and the recording's own markers put them in FOUR
// different situations:
//
//   deferred        12  build --plan/--manifest/--manifest-from/--all/--ci/…
//                       "Accepted by other commands; not implemented for
//                       `build` yet (tan-cli#427)" — the capability is coming.
//   compatibility    1  doctor --build, "Accepted for compatibility
//                       (tan-cli#290)" — kept so old callers do not break.
//   parity           2  renode --board-yaml/--image-bundle, "Accepted for
//                       parity with every other command's global flag".
//   not-applicable   2  faultdecode --project/--sdk-root, "(unused:
//                       faultdecode is HW-free)".
//
// Only the first will ever start doing something. Telling a customer that
// `doctor --build` is "deferred, see tan-cli#427" would promise an arrival that
// is not coming, and calling `renode --board-yaml` live would claim an effect
// it does not have. `inert` alone cannot separate them: it is a boolean, and
// the reason lives in `marker` prose with a `ref` that is null for four of the
// six markers.
//
// So the kind is DECLARED in `src/` and held to the recording by a gate, the
// way MODEL_SUBCOMMANDS and DEFERRED_BUILD_OPTIONS already are — not sniffed
// out of the marker text. Classifying on prose is the mistake that shipped in
// the proxy classifier (#511): a condition pinned to one spelling, blind to
// every other. There is no code to classify on here, so nothing is classified
// at runtime at all.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inertKindOf,
  deferredBuildOptionMessage,
} = require("../out/alpCli/pinnedSurface.js");

test("each recorded kind of inertness is told apart", () => {
  assert.equal(inertKindOf("build", "--plan"), "deferred");
  assert.equal(inertKindOf("doctor", "--build"), "compatibility");
  assert.equal(inertKindOf("renode", "--board-yaml"), "parity");
  assert.equal(inertKindOf("faultdecode", "--project"), "not-applicable");
});

test("a live option has no kind at all", () => {
  // The control. A classifier that answered "deferred" for everything would
  // pass every assertion above and turn two working buttons into notices.
  assert.equal(
    inertKindOf("build", "--materialise"),
    null,
    "`tan build --materialise` is live at this pin and the Build Plan panel " +
      "depends on it",
  );
  assert.equal(inertKindOf("build", "--plan-from"), null);
  assert.equal(
    inertKindOf("build", "--no-such-flag"),
    null,
    "an unknown flag is not inert, it is unknown",
  );
});

test("every deferred build flag is described as deferred, not as working", () => {
  // `--all` and `--ci` are recorded inert under tan-cli#427 exactly like
  // `--plan` is. The message consulted a three-flag list — the flags the Build
  // Plan panel would SEND — and said of everything else that it "does
  // something", so nine of the twelve deferred build flags were described to
  // the customer as working.
  for (const flag of [
    "--plan",
    "--manifest",
    "--manifest-from",
    "--all",
    "--ci",
  ]) {
    const message = deferredBuildOptionMessage(flag);
    assert.match(
      message,
      /is deferred in tan/,
      `\`tan build ${flag}\` is recorded inert under tan-cli#427 — ${message}`,
    );
    assert.doesNotMatch(
      message,
      /it does something/,
      `\`tan build ${flag}\` does nothing at this pin — ${message}`,
    );
  }
});

test("a live flag is still described as live", () => {
  const message = deferredBuildOptionMessage("--materialise");
  assert.match(message, /is NOT deferred/);
  assert.match(
    message,
    /it does something/,
    "the panel's own gap must not be blamed on the CLI",
  );
});

test("an inert flag that is NOT deferred is not promised an arrival", () => {
  // Reachable the moment a call site passes one, and the sentence must not
  // name tan-cli#427: `doctor --build` is kept for compatibility and is never
  // going to start working.
  const message = deferredBuildOptionMessage("--board-yaml", "renode");
  assert.doesNotMatch(
    message,
    /tan-cli#427/,
    `parity inertness is not the deferred kind — ${message}`,
  );
  assert.doesNotMatch(
    message,
    /it does something/,
    `\`tan renode --board-yaml\` is accepted and ignored — ${message}`,
  );
});
