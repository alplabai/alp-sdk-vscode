// SPDX-License-Identifier: Apache-2.0
//
// The webview's app-directory guard must answer exactly like core's (#538).
//
// The webview cannot import `@alp-sdk/core` — `packages/alp-webview/src/types.ts`
// records that as deliberate — so `shared/appDir.ts` is a hand copy of
// `project/coreScaffold.ts`'s two helpers. A hand copy is a drift risk, and the
// drift is silent in the direction that matters: if the webview grew LOOSER
// than the host, the wizard would accept a directory the host then refuses, and
// the customer would press Create and get a project missing a core.
//
// So this compares the two implementations on the same inputs rather than
// asserting a list of expectations twice.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../packages/alp-core/dist/project/coreScaffold.js");

const MIRROR_REL = "packages/alp-webview/src/shared/appDir.ts";
const mirrorSrc = fs.readFileSync(
  path.join(__dirname, "..", MIRROR_REL),
  "utf8",
);

/** The mirror is TypeScript with no imports, so its two functions can be
 *  evaluated directly once the type annotations are stripped. */
function loadMirror() {
  const js = mirrorSrc
    .replace(/export function/g, "function")
    .replace(/\(app: string\): boolean/g, "(app)")
    .replace(/\(app: string\): string/g, "(app)")
    .replace(/const parts: string\[\]/g, "const parts")
    .replace(/const out: string\[\] = \[\]/g, "const out = []");
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn { isSafeAppDir, normaliseAppDir };`)();
}

const CASES = [
  "./src",
  "src",
  "./cores/m55_he",
  "./src/../peer",
  "./a/../src",
  "",
  "   ",
  "..",
  "../..",
  "../../../etc",
  "/etc/alp",
  "C:\\Windows\\Temp",
  "\\\\server\\share",
  "./src/../../escape",
  "peer/",
  "./PEER",
];

test("the mirror accepts and refuses exactly what core does", () => {
  const mirror = loadMirror();

  for (const value of CASES) {
    assert.equal(
      mirror.isSafeAppDir(value),
      core.isSafeAppDir(value),
      `isSafeAppDir disagreed on ${JSON.stringify(value)}`,
    );
  }
});

test("the mirror normalises exactly like core", () => {
  const mirror = loadMirror();

  for (const value of CASES) {
    assert.equal(
      mirror.normaliseAppDir(value),
      core.normaliseAppDir(value),
      `normaliseAppDir disagreed on ${JSON.stringify(value)}`,
    );
  }
});

test("the mirror imports nothing — it cannot, and must not start", () => {
  // The webview has no node and does not import core; an import here would
  // break the bundle rather than the test, so catch it here.
  assert.doesNotMatch(mirrorSrc, /^\s*import\s/m);
});
