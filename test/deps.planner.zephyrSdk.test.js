// SPDX-License-Identifier: Apache-2.0
//
// The Zephyr SDK row had no button on a real Windows install, and the reason
// was that "tan named no prerequisite for this check" was being read as "there
// is nothing to offer".
//
// tan v0.4.0 builds `missingPrerequisites` inside `push_tool`
// (`crates/tan-core/src/build_readiness.rs:553`, `missing.push` at `:573`), and
// the `zephyrSdk` check is pushed as a plain struct literal at `:384` that
// never goes through it. Driven against the pinned binary on Windows 11 the
// envelope below is what comes back, verbatim: a `zephyrSdk` check at `warn`
// carrying tan's prose, and a `missingPrerequisites` list that does not mention
// it. tan-cli owes the routing fix; this file pins OUR half — a check tan's
// list is silent about still gets whatever remedy this extension knows.
//
// The complement is asserted too: for a tool tan DID speak for, tan's answer
// stays final, `command: null` included.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");

/**
 * The `data` payload of `tan doctor --build --format json`, driven on Windows
 * 11 against the pinned tan v0.4.0 in a folder holding alp-sdk's own
 * `metadata/templates/board.yaml`. Trimmed to the checks under test; every
 * string is the binary's own.
 */
const data = {
  summary: { pass: 4, warn: 7, fail: 3 },
  checks: [
    { name: "cmake", status: "pass", detail: "cmake is available." },
    {
      name: "ninja",
      status: "fail",
      detail: "ninja not found on PATH — needed for Zephyr builds.",
      fix: "Install Ninja. `winget install -e --id Ninja-build.Ninja`",
    },
    {
      name: "west",
      status: "warn",
      detail: "west not found on PATH — needed for Zephyr builds.",
      fix: "Install west via `tan bootstrap`.",
    },
    {
      name: "westResolved",
      status: "warn",
      detail:
        "west not found — run `tan bootstrap` to create the workspace venv",
      fix: "tan bootstrap",
    },
    {
      name: "dtc",
      status: "warn",
      detail: "dtc not found on PATH — needed for Zephyr builds.",
      fix: "Install the devicetree compiler (dtc).",
    },
    {
      name: "zephyrSdk",
      status: "warn",
      detail:
        "Zephyr SDK toolchain not detected (ZEPHYR_SDK_INSTALL_DIR unset).",
      fix: "Install the Zephyr SDK: https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html",
    },
    {
      name: "vendorToolchain",
      status: "warn",
      detail:
        "Baremetal needs a vendor toolchain (Alif/Renesas/NXP), per SoC family.",
      fix: "Install the vendor toolchain for your SoC (see docs/getting-started.md §8).",
    },
  ],
  missingPrerequisites: [
    { tool: "west", command: null },
    { tool: "ninja", command: "winget install -e --id Ninja-build.Ninja" },
    { tool: "dtc", command: null },
    { tool: "gperf", command: null },
  ],
};

const plan = (over = {}) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: { installed: "0.4.0", latest: { version: "0.4.0", kind: "pin" } },
    compareVersions: () => "same",
    host: "win32",
    ...over,
  });

const rowFor = (report, name) => report.rows.find((r) => r.name === name);

test("the Zephyr SDK row gets a button tan's list never offered", () => {
  const row = rowFor(plan(), "zephyrSdk");
  assert.equal(row.status, "warn", "tan's verdict, verbatim");
  assert.ok(
    row.action,
    "a Fail/Warn row the customer can act on and no button",
  );
  assert.equal(row.action.kind, "fix");
  assert.equal(row.action.fixId, "zephyr-sdk");
  // NOT "install": pressing opens a web page. `Open install guide` is the
  // label the view puts on `open-docs`, and it is the truth.
  assert.equal(row.action.effect, "open-docs");
});

test("the tooltip says what the page does NOT: the command and its preconditions", () => {
  const title = rowFor(plan(), "zephyrSdk").action.title;
  assert.match(title, /nothing is installed/, "the pointer stays honest");
  assert.match(title, /west sdk install -t arm-zephyr-eabi/);
  assert.match(title, /top-level directory/, "west needs the workspace root");
  // The hard native-Windows prerequisite that appears nowhere else in this
  // repo: west delegates .7z extraction to patoolib, which shells out.
  assert.match(title, /7-Zip/);
  assert.match(title, /7z \/ 7za \/ 7zr \/ 7zz \/ 7zzs \/ unar/);

  // Not on POSIX — there the SDK ships a .tar.xz west can unpack itself, and a
  // 7-Zip sentence would be noise.
  const posix = rowFor(plan({ host: "linux" }), "zephyrSdk").action.title;
  assert.match(posix, /west sdk install -t arm-zephyr-eabi/);
  assert.doesNotMatch(posix, /7-Zip/);
});

test("a version the repo cannot keep true is never printed", () => {
  // This repo pins tan (SUPPORTED_CLI_VERSION), not the Zephyr SDK. A
  // `--version 1.0.1` written into the tooltip is a number with no gate behind
  // it, and it goes stale silently the day sdk-ng moves.
  for (const host of ["win32", "linux", "darwin"]) {
    assert.doesNotMatch(
      rowFor(plan({ host }), "zephyrSdk").action.title,
      /--version/,
      `${host}: an unpinnable Zephyr SDK version reached the tooltip`,
    );
  }
});

test("tan's own answer still wins wherever tan gave one", () => {
  const report = plan();
  // A command tan supplied: verbatim, untouched by the fallback.
  assert.deepEqual(rowFor(report, "ninja").action, {
    kind: "command",
    commands: [
      { tool: "ninja", command: "winget install -e --id Ninja-build.Ninja" },
    ],
    effect: "install",
    title: "winget install -e --id Ninja-build.Ninja",
  });
  // `command: null` is tan's ANSWER — "tan knows no command" — and the local
  // fix map must not be consulted behind its back. `west` is in FIX_IDS and
  // would otherwise have produced `python -m pip install --user west` on
  // win32, contradicting tan's own "Install west via `tan bootstrap`.".
  assert.equal(rowFor(report, "west").action, null);
  assert.equal(rowFor(report, "dtc").action, null);
});

test("a check with no known remedy still gets no button", () => {
  // Absent from `missingPrerequisites` AND from the fix map. The fallback must
  // not invent anything — tan's prose hint is the whole remedy.
  const row = rowFor(plan(), "vendorToolchain");
  assert.equal(row.action, null);
  assert.equal(
    row.hint,
    "Install the vendor toolchain for your SoC (see docs/getting-started.md §8).",
  );
});

test("westResolved is bootstrapped, never pip-installed", () => {
  // tan lists `west` but not `westResolved`, so the fallback fires here too.
  // The venv is the only thing that satisfies this check, so the action must be
  // a bootstrap on EVERY host — a win32 `pip install --user west` puts west
  // somewhere the check does not look and leaves the row exactly as it was.
  for (const host of ["win32", "linux", "darwin"]) {
    const action = rowFor(plan({ host }), "westResolved").action;
    assert.equal(action.kind, "fix", host);
    assert.equal(action.fixId, "west-workspace", host);
    assert.equal(action.effect, "bootstrap", host);
    assert.doesNotMatch(action.title, /pip install/, host);
  }
});

test("a bootstrap already running still suppresses the new button", () => {
  const report = plan({ bootstrapRunning: true });
  for (const row of report.rows) {
    assert.equal(row.action, null, `${row.name} raced a running bootstrap`);
  }
});
