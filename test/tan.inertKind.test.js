// SPDX-License-Identifier: Apache-2.0
//
// An inert option is not one thing.
//
// `test/golden/tan-surface/surface.json` records 51 options as `inert: true`,
// and the recording's own markers put them in FOUR different situations:
//
//   deferred        12  build --plan/--manifest/--manifest-from/--all/--ci/…
//                       "Accepted by other commands; not implemented for
//                       `build` yet (tan-cli#427)" — the capability is coming.
//   compatibility    1  doctor --build, "Accepted for compatibility
//                       (tan-cli#290)" — kept so old callers do not break.
//   parity          35  diff/faultdecode/inspect/pinmux/support-bundle/trace's
//                       global ergonomics flags (--all/--ci/--no-color/
//                       --non-interactive/--quiet/--target/--verbose), each
//                       command's own description paragraph naming the
//                       reason verbatim: "the oracle's clap `GlobalArgs` are
//                       `global = true`, so every verb accepts all of them"
//                       (#602). HAD no instance between v0.6.0 removing
//                       `renode` (tan-cli#848, #584 — `renode
//                       --board-yaml`/`--image-bundle` were the previous two)
//                       and #602's first pass, which misclassified all 36
//                       of these `not-applicable` before an adversarial
//                       review caught the distinction below.
//   not-applicable   3  faultdecode --project/--sdk-root/--board-yaml,
//                       "(unused: faultdecode is HW-free)" / "reads no
//                       board.yaml and drives no alp-sdk checkout -- it is
//                       pure ARMv8-M register arithmetic" — a genuine DOMAIN
//                       reason specific to this one command, not the generic
//                       "every verb has it" reason `parity` names. The line
//                       between the two: `parity` flags are applicable
//                       concepts a command declines to implement;
//                       `not-applicable` flags are concepts that do not mean
//                       anything for this command's domain at all.
//
// Only the first will ever start doing something. Telling a customer that
// `doctor --build` is "deferred, see tan-cli#427" would promise an arrival that
// is not coming, and calling `faultdecode --project` live would claim an effect
// it does not have. `inert` alone cannot separate them: it is a boolean, and
// the reason lives in `marker` prose with a `ref` that is null for two of the
// four markers.
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
  INERT_OPTIONS,
} = require("../out/alpCli/pinnedSurface.js");

test("each recorded kind of inertness is told apart", () => {
  assert.equal(inertKindOf("build", "--plan"), "deferred");
  assert.equal(inertKindOf("doctor", "--build"), "compatibility");
  assert.equal(inertKindOf("faultdecode", "--project"), "not-applicable");
  // `faultdecode --board-yaml` is the domain exclusion, same reason as
  // `--project`/`--sdk-root` just above — NOT `parity`, even though it is
  // one of the 36 flags #602 added, because faultdecode's own marker names
  // board.yaml specifically rather than the generic "every verb accepts all
  // of them" wording.
  assert.equal(inertKindOf("faultdecode", "--board-yaml"), "not-applicable");
  // `parity` has a real instance again as of #602 — `diff --all` is one of
  // 35. Pinned as a POSITIVE case now rather than an asserted absence.
  assert.equal(inertKindOf("diff", "--all"), "parity");
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
  // Split by what tan-cli#427 actually did to each, which is not uniform: it
  // RETIRED `--plan`/`--manifest`/`--manifest-from` and left the rest deferred.
  // Both wordings are correct; describing either as working is not.
  const RETIRED = ["--plan", "--manifest", "--manifest-from"];
  const STILL_DEFERRED = ["--all", "--ci"];

  for (const flag of [...RETIRED, ...STILL_DEFERRED]) {
    const message = deferredBuildOptionMessage(flag);
    // The invariant this test exists for, and it holds across both wordings.
    assert.doesNotMatch(
      message,
      /it does something/,
      `\`tan build ${flag}\` does nothing at this pin — ${message}`,
    );
  }

  for (const flag of STILL_DEFERRED) {
    assert.match(
      deferredBuildOptionMessage(flag),
      /is deferred in tan/,
      `\`tan build ${flag}\` is recorded inert under tan-cli#427`,
    );
  }

  for (const flag of RETIRED) {
    const message = deferredBuildOptionMessage(flag);
    assert.match(
      message,
      /is retired/,
      `\`tan build ${flag}\` was retired by tan-cli#427, not deferred by it`,
    );
    assert.doesNotMatch(
      message,
      /is deferred in tan/,
      `\`tan build ${flag}\` is not coming back, so the message must not ` +
        `read as a wait — ${message}`,
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
  // `faultdecode --project`, not `renode --board-yaml`: the parity example
  // this test used went with the verb tan v0.6.0 removed (#584). Same point,
  // a kind that still has an instance.
  const message = deferredBuildOptionMessage("--project", "faultdecode");
  assert.doesNotMatch(
    message,
    /tan-cli#427/,
    `not-applicable inertness is not the deferred kind — ${message}`,
  );
  assert.doesNotMatch(
    message,
    /it does something/,
    `\`tan faultdecode --project\` is accepted and ignored — ${message}`,
  );
});
