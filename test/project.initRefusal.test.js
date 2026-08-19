// SPDX-License-Identifier: Apache-2.0
//
// Classifying the two ways `tan init` refuses a (template, SoM) pair (#530).
//
// The New Project flow lets a customer pick any template with any SoM, and 12
// of the 44 pairs cannot be scaffolded. Measured against the pinned tan
// 0.6.0-rc1 with alp-sdk v0.16.0-rc1:
//
//   minimal-app      ok on all 11 SoMs
//   zephyr-app       ok except E1M-NX9101        -> init.som-unsupported
//   sensor-starter   ok except E1M-NX9101        -> init.som-unsupported
//   iot-starter      ok ONLY on E1M-AEN801       -> init.invalid-som  (10 SoMs)
//
// Two DIFFERENT codes, needing two different sentences: one means "no scaffold
// tree exists for this SoM's family", the other "this template is pinned to one
// SKU". Telling a customer to try another SoM when the template ships no tree
// for theirs sends them round the wizard for nothing.
//
// CLASSIFIED ON THE CODE, never on the prose — the same rule
// `features/models/cliSurface.ts` follows. tan's message text is display-only
// here: it is forwarded verbatim because it names the supported SKU, and it is
// never parsed to decide anything.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyInitRefusal,
} = require("../packages/alp-core/dist/project/initRefusal.js");

// Verbatim from tan 0.6.0-rc1.
const NO_SCAFFOLD = {
  code: "init.som-unsupported",
  severity: "error",
  message:
    "Template 'zephyr-app' has no vendored scaffold for SoM 'E1M-NX9101'. tan ships scaffold trees for the E1M-AEN* and E1M-V2N*/E1M-V2M* families only",
};
const PINNED = {
  code: "init.invalid-som",
  severity: "error",
  message:
    "Template 'iot-starter' supports only SoM SKU 'E1M-AEN801'; got 'E1M-NX9101'.",
};

test("a missing scaffold tree is classified as such", () => {
  const refusal = classifyInitRefusal([NO_SCAFFOLD]);

  assert.equal(refusal.kind, "no-scaffold-for-som");
  assert.equal(refusal.code, "init.som-unsupported");
  assert.equal(refusal.message, NO_SCAFFOLD.message);
});

test("a template pinned to one SKU is a DIFFERENT kind", () => {
  // The distinction is the whole point: this one is fixable by changing the
  // SoM, the other one is not.
  const refusal = classifyInitRefusal([PINNED]);

  assert.equal(refusal.kind, "template-pinned-to-som");
  assert.equal(refusal.code, "init.invalid-som");
  assert.equal(refusal.message, PINNED.message);
});

test("any other refusal is left alone", () => {
  // `init.invalid-cores` is #528's code and has its own fix; swallowing it into
  // this guidance would send the customer to the wrong screen.
  assert.equal(
    classifyInitRefusal([
      { code: "init.invalid-cores", severity: "error", message: "..." },
    ]),
    null,
  );
});

test("prose alone never classifies", () => {
  // The anti-prose assertion. A message that reads exactly like the pinned-SKU
  // refusal, under a code that is not one of the two, must NOT be classified —
  // tan owns the vocabulary and this extension reads only the code.
  assert.equal(
    classifyInitRefusal([
      {
        code: "init.something-else",
        severity: "error",
        message: "Template 'iot-starter' supports only SoM SKU 'E1M-AEN801'.",
      },
    ]),
    null,
  );
});

test("the first matching issue wins, and the rest are left to the caller", () => {
  const refusal = classifyInitRefusal([
    { code: "init.warning", severity: "warning", message: "unrelated" },
    PINNED,
    NO_SCAFFOLD,
  ]);

  assert.equal(refusal.kind, "template-pinned-to-som");
});

test("a malformed or absent issue list is not a refusal", () => {
  // The envelope is external data: `issues` can be absent, null, or something
  // that is not a list at all, and none of those may throw here.
  assert.equal(classifyInitRefusal(undefined), null);
  assert.equal(classifyInitRefusal(null), null);
  assert.equal(classifyInitRefusal([]), null);
  assert.equal(classifyInitRefusal("init.invalid-som"), null);
  assert.equal(classifyInitRefusal([null, 42, "x"]), null);
  assert.equal(classifyInitRefusal([{ severity: "error" }]), null);
});

test("an issue carrying the code but no message still classifies", () => {
  // The code is what decides; a missing message costs the quoted sentence, not
  // the guidance.
  const refusal = classifyInitRefusal([{ code: "init.som-unsupported" }]);

  assert.equal(refusal.kind, "no-scaffold-for-som");
  assert.equal(refusal.message, null);
});
