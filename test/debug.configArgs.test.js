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
const { TASK_SPECS, taskLabel } = require(
  path.join(__dirname, "..", "out", "tasks", "service.js"),
);

test("zephyr-mcu/jlink before a build carries no --core", () => {
  // `resolveManifestSlice` reads `build/system-manifest.yaml`, which does not
  // exist pre-build, so `coreId` is null and tan picks the slice itself. The
  // build task is still named: pre-build is exactly when it matters most —
  // this is the first F5 on a fresh clone, with no ELF on disk at all.
  assert.deepStrictEqual(
    debugConfigArgs({
      targetKind: "zephyr-mcu",
      server: "jlink",
      coreId: null,
    }),
    [
      "debug-config",
      "--target-kind",
      "zephyr-mcu",
      "--server",
      "jlink",
      "--pre-launch-task",
      "alp: build active target",
    ],
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
      "--pre-launch-task",
      "alp: build active target",
    ],
  );
});

test("every target/server pair the picker can produce is spelled exactly", () => {
  // Whole-array equality per pair, so a value swapped between two legal values
  // — `--server openocd` where the user picked `pyocd` — is caught. The picker
  // is what limits the pairs; these are the ones it can hand over.
  //
  // The `--pre-launch-task` VALUE is the half that only this file can defend.
  // A wrong flag exits 2; a wrong LABEL — `alp: build native_sim target` on a
  // zephyr-mcu profile — is a string VS Code resolves to a real registered
  // task, so it builds, F5 starts, and nothing anywhere reports that the
  // profile named the wrong one.
  const cases = [
    ["zephyr-mcu", "jlink", "alp: build active target"],
    ["zephyr-mcu", "openocd", "alp: build active target"],
    ["zephyr-mcu", "pyocd", "alp: build active target"],
    ["baremetal-mcu", "jlink", "alp: build baremetal target"],
    ["baremetal-mcu", "openocd", "alp: build baremetal target"],
    ["baremetal-mcu", "pyocd", "alp: build baremetal target"],
    // No task: the only one registered for this kind exits 1 by design (see
    // `preLaunchTaskFor`), so the flag is omitted and the profile keeps the
    // no-preLaunchTask shape it has always had.
    ["yocto-userspace", "gdbserver", null],
    ["native-host", "none", "alp: build native_sim target"],
  ];
  for (const [targetKind, server, task] of cases) {
    assert.deepStrictEqual(
      debugConfigArgs({ targetKind, server, coreId: null }),
      [
        "debug-config",
        "--target-kind",
        targetKind,
        "--server",
        server,
        ...(task ? ["--pre-launch-task", task] : []),
      ],
      `${targetKind}/${server}`,
    );
  }
});

test("the task label is the one the provider really contributes, not a lookalike", () => {
  // `debugConfigArgs` spells a label that has to survive a round trip through
  // VS Code: it is matched against `${TASK_SOURCE}: ${spec.name}` for a task
  // `AlpTaskProvider.provideTasks` returned. Comparing against the same
  // TASK_SPECS the provider maps over is what makes a rename on either side
  // fail here rather than at F5 — the case above pins the literal, this one
  // pins that the literal is still a label something answers to.
  const provided = new Set(TASK_SPECS.map(taskLabel));
  const emitted = [
    "zephyr-mcu",
    "baremetal-mcu",
    "yocto-userspace",
    "native-host",
  ].map((targetKind) => {
    const args = debugConfigArgs({
      targetKind,
      server: targetKind === "yocto-userspace" ? "gdbserver" : "jlink",
      coreId: null,
    });
    const at = args.indexOf("--pre-launch-task");
    return at === -1 ? null : args[at + 1];
  });

  // Non-vacuity first: a `debugConfigArgs` that emits the flag for nothing
  // would satisfy every "each emitted label is contributed" loop trivially,
  // which is the shape of this test that would have passed on the bug it
  // exists to prevent.
  assert.equal(emitted.filter(Boolean).length, 3);
  for (const label of emitted.filter(Boolean)) {
    assert.ok(
      provided.has(label),
      `${JSON.stringify(label)} is not a contributed task label`,
    );
  }
});

test("--core and --pre-launch-task coexist without displacing each other", () => {
  // Both are conditional pushes onto the same array. The post-build zephyr
  // case is the only one carrying both, and it is the one a customer actually
  // presses F5 on.
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
      "--pre-launch-task",
      "alp: build active target",
    ],
  );
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
      [
        "debug-config",
        "--target-kind",
        "zephyr-mcu",
        "--server",
        "jlink",
        "--pre-launch-task",
        "alp: build active target",
      ],
      `coreId=${JSON.stringify(coreId)}`,
    );
  }
});

test("--svd carries the alpSdk.svdPath value, positioned after --pre-launch-task and before --preview", () => {
  // #340. Mirrors the --core / --pre-launch-task conditional-push pattern:
  // pushed by VALUE, not merely present, and ordered with the rest of the
  // spec-derived flags ahead of the call-time --preview tail.
  assert.deepStrictEqual(
    debugConfigArgs(
      { targetKind: "zephyr-mcu", server: "jlink", coreId: "m55_hp" },
      { svdPath: "vendor/E8.svd" },
    ),
    [
      "debug-config",
      "--target-kind",
      "zephyr-mcu",
      "--server",
      "jlink",
      "--core",
      "m55_hp",
      "--pre-launch-task",
      "alp: build active target",
      "--svd",
      "vendor/E8.svd",
    ],
  );

  assert.deepStrictEqual(
    debugConfigArgs(
      { targetKind: "zephyr-mcu", server: "jlink", coreId: "m55_hp" },
      { svdPath: "vendor/E8.svd", preview: true },
    ),
    [
      "debug-config",
      "--target-kind",
      "zephyr-mcu",
      "--server",
      "jlink",
      "--core",
      "m55_hp",
      "--pre-launch-task",
      "alp: build active target",
      "--svd",
      "vendor/E8.svd",
      "--preview",
    ],
    "--preview must still be the tail with --svd present",
  );
});

test("--svd is absent when alpSdk.svdPath is empty, undefined, or omitted entirely", () => {
  // `--svd ""` is not the same command as no `--svd` — same reasoning as the
  // empty-coreId case above: tan would take the empty string as an explicit
  // (invalid) selection rather than skipping SVD resolution.
  const base = { targetKind: "zephyr-mcu", server: "jlink", coreId: null };
  const withoutSvd = [
    "debug-config",
    "--target-kind",
    "zephyr-mcu",
    "--server",
    "jlink",
    "--pre-launch-task",
    "alp: build active target",
  ];

  assert.deepStrictEqual(
    debugConfigArgs(base),
    withoutSvd,
    "no options at all",
  );
  assert.deepStrictEqual(
    debugConfigArgs(base, {}),
    withoutSvd,
    "options with no svdPath key",
  );
  assert.deepStrictEqual(
    debugConfigArgs(base, { svdPath: "" }),
    withoutSvd,
    "svdPath: empty string",
  );
  assert.deepStrictEqual(
    debugConfigArgs(base, { svdPath: null }),
    withoutSvd,
    "svdPath: null",
  );
});

test("--svd trims a whitespace-only value to nothing, and a padded one to its real path (#340 review)", () => {
  // Measured against the pinned tan: `--svd "   "` exits 5 refusing an
  // "empty path", and `--svd "dummy.svd "` (one trailing space) exits 5 on
  // the literal, unreadable padded filename. Both are HARD failures of the
  // whole command, so `debugConfigArgs` must not forward either shape as-is
  // — this is its OWN trim, independent of whatever `readSvdPath` already did
  // (`src/project/vscodeAdapter.ts`), since this function is the one directly
  // under test here.
  const base = { targetKind: "zephyr-mcu", server: "jlink", coreId: null };
  const withoutSvd = [
    "debug-config",
    "--target-kind",
    "zephyr-mcu",
    "--server",
    "jlink",
    "--pre-launch-task",
    "alp: build active target",
  ];

  for (const whitespace of ["   ", "\t\n"]) {
    assert.deepStrictEqual(
      debugConfigArgs(base, { svdPath: whitespace }),
      withoutSvd,
      `svdPath: ${JSON.stringify(whitespace)} must be omitted, not sent as --svd ""`,
    );
  }

  assert.deepStrictEqual(
    debugConfigArgs(base, { svdPath: "dummy.svd " }),
    [...withoutSvd, "--svd", "dummy.svd"],
    "a trailing-space paste is trimmed before being sent, not sent padded",
  );
  assert.deepStrictEqual(
    debugConfigArgs(base, { svdPath: "  vendor/E8.svd" }),
    [...withoutSvd, "--svd", "vendor/E8.svd"],
    "a leading-space paste is trimmed too",
  );
});

test("the subcommand is first, so the argv is a debug-config invocation at all", () => {
  const args = debugConfigArgs({
    targetKind: "native-host",
    server: "none",
    coreId: null,
  });
  assert.equal(args[0], "debug-config");
});
