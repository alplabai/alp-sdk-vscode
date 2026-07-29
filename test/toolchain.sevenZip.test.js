// SPDX-License-Identifier: Apache-2.0
//
// 7-Zip is a HARD prerequisite of `west sdk install` on native Windows — west
// hands `.7z` extraction to `patoolib`, which shells out to an external
// extractor and has no pure-Python fallback — and before this file `grep 7z`
// over `src/` returned nothing at all. It exists upstream only as prose in
// alp-sdk's `metadata/bootstrap.json` `manualInstallHints.windows.note`, which
// only `tan bootstrap`'s TEXT output renders; a customer driving the extension
// never sees it.
//
// The rule under test is the one `probeTool` gets wrong for this family: only
// `ENOENT` is absence. Driven on Windows 11 against the real binary — a bogus
// switch to a present `7z` throws with `status: 7` and NO `code`, while an
// absent `7zz` throws `code: "ENOENT"` — so reading "the spawn failed" as "not
// installed" would report a machine that HAS an extractor as missing one.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/toolchain/vscodeAdapter.js with `vscode` stubbed — the module is
 *  reached through `../project/vscodeAdapter`, which requires it at load time.
 *  The loader swap lasts only for the synchronous require. */
function loadAdapter() {
  const modPath = require.resolve(
    path.join(root, "out", "toolchain", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") {
      return {
        workspace: {
          workspaceFolders: undefined,
          getConfiguration: () => ({ get: () => undefined }),
        },
        window: {},
      };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
  }
}

const { probeSevenZip, probeExtractor } = loadAdapter();

/** A fake PATH: `present` names resolve, everything else throws ENOENT the way
 *  `execFileSync` does. */
const onPath = (present, banner = "7-Zip 24.09 (x64)") =>
  function fakeProbe(cmd) {
    if (!present.includes(cmd)) return { present: false };
    return { present: true, detail: banner };
  };

test("any one extractor is enough, and the first hit wins", () => {
  // patoolib takes the first it finds, so the probe must too.
  assert.deepEqual(probeSevenZip(onPath(["7z"])), {
    present: true,
    detail: "7-Zip 24.09 (x64)",
  });
  // A machine with only `7zz` (the 7-Zip 21.07+ POSIX binary name) or only
  // `unar` is equally able to extract the SDK archive.
  assert.equal(probeSevenZip(onPath(["7zz"])).present, true);
  assert.equal(probeSevenZip(onPath(["unar"])).present, true);
});

test("no extractor at all is a clean absent, with no invented detail", () => {
  const result = probeSevenZip(onPath([]));
  assert.deepEqual(result, { present: false });
});

test("every name patoolib shells out to is probed", () => {
  const seen = [];
  probeSevenZip((cmd) => {
    seen.push(cmd);
    return { present: false };
  });
  assert.deepEqual(seen, ["7z", "7za", "7zr", "7zz", "7zzs", "unar"]);
});

test("the real probe answers with a boolean and never throws", () => {
  // No presence assertion: CI runners and developer boxes differ, and the point
  // is that the probe survives either. Driven on Windows 11 this box answers
  // `{ present: true, detail: "NanaZip 6.5 Update (x64) : (c) M2-Team and
  // Contributors. All rights reserved." }` from
  // C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\7z.exe.
  const result = probeSevenZip();
  assert.equal(typeof result.present, "boolean");
  if (result.present) {
    assert.equal(typeof result.detail, "string");
    assert.ok(result.detail.length > 0, "a present extractor with no detail");
  } else {
    assert.equal(result.detail, undefined);
  }
});

test("a binary that RAN and complained is PRESENT, not missing", () => {
  // The `probeTool` trap: it catches every throw and answers `{present:false}`.
  // 7-Zip family binaries reject an unknown switch with a non-zero exit — a
  // real `7z` on this Windows box exits `status: 7` — so that rule reports a
  // fully installed extractor as absent.
  //
  // Driven against a real child process rather than a fake, and `node` is the
  // one binary guaranteed present on every runner this suite runs on.
  assert.deepEqual(probeExtractor(process.execPath, ["--not-a-real-flag"]), {
    present: true,
    detail: process.execPath,
  });
});

test("only ENOENT is absence", () => {
  assert.deepEqual(probeExtractor("alp-sdk-no-such-extractor-binary"), {
    present: false,
  });
});

test("the detail is the banner's FIRST line", () => {
  // 7-Zip prints a multi-line banner; the row shows one line.
  const probe = probeExtractor(process.execPath, [
    "-e",
    "console.log('7-Zip 24.09 (x64)\\nusage: ...')",
  ]);
  assert.deepEqual(probe, { present: true, detail: "7-Zip 24.09 (x64)" });
});
