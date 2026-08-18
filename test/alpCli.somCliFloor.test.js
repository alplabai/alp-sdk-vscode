// SPDX-License-Identifier: Apache-2.0
//
// A tan old enough to break a Renesas build must SAY so before the build (#502).
//
// The pin move is only half the fix. `SUPPORTED_CLI_VERSION` governs the
// MANAGED binary; a customer who resolves their own tan through
// `alpSdk.cliPath` or PATH keeps whatever they already had. Against tan v0.5.1
// every Renesas SKU dies mid-configure with
//
//   alp.conf:27: warning: attempt to assign the value 'y' to the undefined
//       symbol ALP_SDK_CHIP_NONE
//   error: Aborting due to Kconfig warnings
//
// which names neither the CLI nor the SoM, so nothing on screen points at the
// version. That is what this module exists to say out loud.
//
// The comparison is against the PROBED version, never `SUPPORTED_CLI_VERSION`
// -- the same rule `RENODE_CORE_CLI_VERSION` (src/west.ts) follows: a feature
// gate asks what is RUNNING, not what this build would download.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RENESAS_BUILD_CLI_VERSION,
  isRenesasSku,
  somCliFloorWarning,
} = require("../out/alpCli/somCliFloor.js");
const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");
const { E1M_MODULES } = require("../out/ideHub/projectScaffold.js");

/** The four SKUs alp-sdk-vscode#502 measured as broken, spelled out rather than
 *  derived. Deriving BOTH the module's answer and this expectation from
 *  `E1M_MODULES` would assert only that one filter equals itself; a catalog
 *  edit that dropped `family` from a Renesas entry would then silently stop
 *  warning and stay green. */
const BROKEN_SKUS = ["E1M-V2N101", "E1M-V2N102", "E1M-V2M101", "E1M-V2M102"];

test("every SKU #502 measured as broken is recognised as Renesas", () => {
  // Arrange / Act / Assert
  for (const sku of BROKEN_SKUS) {
    assert.equal(isRenesasSku(sku), true, `${sku} must be recognised`);
  }
});

test("the catalog holds no Renesas SKU beyond the four #502 measured", () => {
  // Arrange -- if a fifth Renesas module is added to E1M_MODULES later, this
  // reds so someone confirms the floor still describes it, rather than the new
  // SKU inheriting a version claim nobody checked.
  const catalogRenesas = E1M_MODULES.filter((m) => isRenesasSku(m.id)).map(
    (m) => m.id,
  );

  // Assert
  assert.deepEqual([...catalogRenesas].sort(), [...BROKEN_SKUS].sort());
});

test("no non-Renesas SKU is ever warned about", () => {
  // Arrange -- Alif and NXP build fine on v0.5.1; #502 is Renesas-only, and a
  // blanket "your CLI is old" on every build is how a real warning gets muted.
  const others = E1M_MODULES.filter((m) => !BROKEN_SKUS.includes(m.id));
  assert.ok(
    others.length >= 5,
    "catalog should still hold the non-Renesas SKUs",
  );

  // Act / Assert
  for (const module of others) {
    assert.equal(isRenesasSku(module.id), false, `${module.id} is not Renesas`);
    assert.equal(
      somCliFloorWarning(module.id, "0.4.0"),
      null,
      `${module.id} must not warn even on an ancient tan`,
    );
  }
});

test("a tan below the floor warns, and the text carries every fact the user needs", () => {
  // Arrange / Act
  const warning = somCliFloorWarning("E1M-V2N101", "0.5.1");

  // Assert -- the toast line names the SKU (which of their boards) and both
  // versions (what to change); it must NOT carry the Kconfig dump.
  assert.ok(warning, "v0.5.1 against a Renesas SKU must warn");
  assert.match(warning.cause, /E1M-V2N101/);
  assert.match(warning.cause, /0\.5\.1/);
  assert.match(
    warning.cause,
    new RegExp(RENESAS_BUILD_CLI_VERSION.replace(/\./g, "\\.")),
  );
  assert.ok(
    !warning.cause.includes("ALP_SDK_CHIP_NONE"),
    "the Kconfig dump belongs in the channel, not in a toast",
  );
});

test("the detail reproduces the Kconfig abort verbatim, so it can be searched for", () => {
  // Arrange -- a customer who already hit this has the exact string in their
  // build log and nothing else to go on; paraphrasing it costs them the match.
  const warning = somCliFloorWarning("E1M-V2M102", "0.5.1");

  // Assert
  assert.ok(warning);
  assert.ok(
    warning.detail.includes(
      "attempt to assign the value 'y' to the undefined symbol ALP_SDK_CHIP_NONE",
    ),
    "the Zephyr warning line must appear exactly as Zephyr prints it",
  );
  assert.ok(warning.detail.includes("error: Aborting due to Kconfig warnings"));
  assert.ok(warning.detail.includes("CONFIG_ALP_SDK_CHIP_NONE=y"));
  assert.match(warning.detail, /tan-cli#639/);
});

test("the floor version itself does not warn", () => {
  // Arrange / Act / Assert -- an off-by-one here would nag every customer who
  // took exactly the upgrade the warning told them to take.
  assert.equal(
    somCliFloorWarning("E1M-V2N101", RENESAS_BUILD_CLI_VERSION),
    null,
  );
});

test("a tan newer than the floor does not warn, INCLUDING the GA that follows the rc", () => {
  // Arrange -- the floor is a prerelease, so `0.6.0` must read as newer than
  // `0.6.0-rc1`, not as a different string. This is the case a naive compare
  // gets wrong, and it is the one every customer lands on once v0.6.0 is cut.
  for (const version of ["0.6.0", "0.6.1", "0.7.0", "1.0.0"]) {
    // Act / Assert
    assert.equal(
      somCliFloorWarning("E1M-V2N101", version),
      null,
      `tan ${version} is newer than ${RENESAS_BUILD_CLI_VERSION} and must stay quiet`,
    );
  }
});

test("an unreadable or absent probe stays silent rather than guessing", () => {
  // Arrange -- `probeTanVersion` returns null when the managed binary has not
  // been downloaded yet. Warning there would fire on a first run before any
  // CLI exists, which is noise about a version nobody has chosen.
  for (const probed of [null, "", "not-a-version"]) {
    // Act / Assert
    assert.equal(somCliFloorWarning("E1M-V2N101", probed), null);
  }
});

test("an unknown SKU stays silent", () => {
  // Arrange -- board.yaml's `som.sku` is free text as far as this module is
  // concerned; a SKU outside the catalog gets no claim made about it.
  assert.equal(somCliFloorWarning("E1M-ZZ999", "0.5.1"), null);
  assert.equal(somCliFloorWarning("", "0.5.1"), null);
});

test("the SKU match is exact, not a substring", () => {
  // Arrange -- a prefix/contains match would claim a future `E1M-V2N101X` or a
  // stray `my-E1M-V2N101-copy` that this module knows nothing about.
  assert.equal(isRenesasSku("E1M-V2N1010"), false);
  assert.equal(isRenesasSku("prefix-E1M-V2N101"), false);
});

test("the managed pin satisfies the floor it enforces (#502's pin gate)", () => {
  // Arrange -- THE load-bearing gate. If `SUPPORTED_CLI_VERSION` is ever moved
  // BACK below `RENESAS_BUILD_CLI_VERSION`, every customer on the managed
  // binary would be warned about a CLI this extension chose for them and
  // offered no way to fix -- and Renesas would be quietly broken by default
  // again, which is exactly the state #502 was filed about.
  //
  // This is the only form of the issue's "check that the PINNED tan builds each
  // supported SoM family" that this repo can run: no workflow here executes a
  // real `tan build` (`ci.yml`, `e2e.yml`, `release-vsix.yml` run none), so a
  // true per-SoM build gate needs alp-sdk + Zephyr + a toolchain and belongs in
  // tan-cli's `release-combination.yml`, which today tests the LATEST published
  // tan rather than the version this extension pins.

  // Act
  const managedWouldWarn = somCliFloorWarning(
    "E1M-V2N101",
    SUPPORTED_CLI_VERSION,
  );

  // Assert
  assert.equal(
    managedWouldWarn,
    null,
    `SUPPORTED_CLI_VERSION (${SUPPORTED_CLI_VERSION}) is older than ` +
      `RENESAS_BUILD_CLI_VERSION (${RENESAS_BUILD_CLI_VERSION}), so the managed ` +
      `binary this extension downloads cannot build a Renesas SoM. Move the pin ` +
      `forward, or delete the Renesas SKUs from E1M_MODULES -- do not lower the ` +
      `floor to silence this.`,
  );
});
