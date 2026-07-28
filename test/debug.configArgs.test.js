// SPDX-License-Identifier: Apache-2.0
//
// The argv the extension hands `tan debug-config` (#397).
//
// Since #387 the extension does not write `launch.json`. It builds this argv,
// spawns tan, and takes `data.configuration` from the envelope. The merge
// algorithm is tan's and is covered there; the argv is ours and nothing pinned
// it. No test exercised the extension's CONSTRUCTION of it: the envelope guard
// in `alpCli.service.test.js` pins the response SHAPE rather than the flags
// that produced it, and `test/e2e/cli-smoke.sh` does invoke `debug-config` for
// real but spells its own argv, so it proves tan works and nothing about what
// this extension sends.
//
// WHY A TEST RATHER THAN A COMMENT, which is the whole argument:
//
//   * a wrong FLAG fails loudly. tan exits 2 on an unknown argument and the
//     extension maps that to the version-skew message — that is how the
//     missing `--core` on v0.3.1 was caught in the field, with no test.
//   * a wrong VALUE is silent. `--core m55_hp` against `--core m55_he` is a
//     perfectly valid invocation. It debugs the wrong core, writes a working
//     `launch.json` for it, and reports nothing, anywhere, ever.
//
// So every assertion below is on the ARRAY, element for element. Asserting
// that a spawn happened, or that the array merely CONTAINS `--core`, is the
// tautology this file exists to avoid: both survive the value mutation.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { debugConfigArgs } = require(
  path.join(__dirname, "..", "out", "debug", "service.js"),
);

test("zephyr-mcu/jlink before a build carries no --core", () => {
  // `resolveManifestSlice` reads `build/system-manifest.yaml`, which does not
  // exist pre-build, so `coreId` is null and tan picks the slice itself.
  assert.deepStrictEqual(
    debugConfigArgs({
      targetKind: "zephyr-mcu",
      server: "jlink",
      coreId: null,
    }),
    ["debug-config", "--target-kind", "zephyr-mcu", "--server", "jlink"],
  );
});

test("a resolved slice pins the core, by value", () => {
  // The assertion that matters. `m55_hp` and `m55_he` are both real cores on
  // an E1M-AEN801 and both are accepted by tan, so nothing downstream can tell
  // them apart — this is the only place the difference is ever checked.
  assert.deepStrictEqual(
    debugConfigArgs({
      targetKind: "zephyr-mcu",
      server: "jlink",
      coreId: "m55_hp",
    }),
    [
      "debug-config",
      "--target-kind",
      "zephyr-mcu",
      "--server",
      "jlink",
      "--core",
      "m55_hp",
    ],
  );
});

test("every target/server pair the picker can produce is spelled exactly", () => {
  // Whole-array equality per pair, so a value swapped between two legal values
  // — `--server openocd` where the user picked `pyocd` — is caught. The picker
  // is what limits the pairs; these are the ones it can hand over.
  const cases = [
    ["zephyr-mcu", "jlink"],
    ["zephyr-mcu", "openocd"],
    ["zephyr-mcu", "pyocd"],
    ["baremetal-mcu", "jlink"],
    ["baremetal-mcu", "openocd"],
    ["baremetal-mcu", "pyocd"],
    ["yocto-userspace", "gdbserver"],
    ["native-host", "none"],
  ];
  for (const [targetKind, server] of cases) {
    assert.deepStrictEqual(
      debugConfigArgs({ targetKind, server, coreId: null }),
      ["debug-config", "--target-kind", targetKind, "--server", server],
      `${targetKind}/${server}`,
    );
  }
});

test("the preview is the SAME command plus --preview, and --preview is last", () => {
  // Two invocations per press: preview first, then the real write. They must
  // not drift apart — a preview of a different command is not a preview — and
  // the flag has to be the tail, because everything before it is what actually
  // runs on the second call.
  const spec = {
    targetKind: "zephyr-mcu",
    server: "openocd",
    coreId: "m55_hp",
  };
  const real = debugConfigArgs(spec);
  const preview = debugConfigArgs(spec, { preview: true });

  assert.deepStrictEqual(preview, [...real, "--preview"]);
  assert.equal(preview.at(-1), "--preview");
  // And the real invocation never carries it: writing while claiming to
  // preview is the failure mode that ordering exists to prevent.
  assert.equal(real.includes("--preview"), false);
});

test("an empty core id is omitted, not passed as an empty flag value", () => {
  // `--core ""` is not the same command as no `--core`: tan would take the
  // empty string as an explicit selection rather than falling back to its own
  // slice choice.
  for (const coreId of [null, ""]) {
    assert.deepStrictEqual(
      debugConfigArgs({ targetKind: "zephyr-mcu", server: "jlink", coreId }),
      ["debug-config", "--target-kind", "zephyr-mcu", "--server", "jlink"],
      `coreId=${JSON.stringify(coreId)}`,
    );
  }
});

test("the subcommand is first, so the argv is a debug-config invocation at all", () => {
  const args = debugConfigArgs({
    targetKind: "native-host",
    server: "none",
    coreId: null,
  });
  assert.equal(args[0], "debug-config");
});
