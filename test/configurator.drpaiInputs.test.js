// SPDX-License-Identifier: Apache-2.0
//
// The Configurator's "DRP-AI enabled but an input is missing" check must not
// throw on a board.yaml it did not write (#484 review): a v0.16 file carries
// `drpai: { spec: … }` with none of the three inputs, and a throw here blanks
// the whole Configurator render.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () =>
  import("./webview/esbuildImport.mjs").then((m) =>
    m.importWebviewModule("features/configurator/drpaiInputs.ts"),
  );

const model = (drpai) => ({
  name: "m",
  compile: drpai === undefined ? {} : { drpai },
});

test("a v0.16 `drpai: {spec}` block reads as missing inputs, without throwing", async () => {
  const { drpaiPathMissing } = await load();
  assert.equal(drpaiPathMissing(model({ spec: "x.yaml" })), true);
});

test("non-string / non-array values are missing, not crashes", async () => {
  const { drpaiPathMissing } = await load();
  for (const bad of [
    { input_shape: 3, input_name: "in", images: "imgs" },
    { input_shape: [1], input_name: null, images: "imgs" },
    { input_shape: [1], input_name: "in", images: ["a"] },
    { input_shape: "", input_name: "in", images: "imgs" },
    { input_shape: [], input_name: "in", images: "imgs" },
    { input_shape: "1,3", input_name: "  ", images: "imgs" },
  ]) {
    assert.equal(drpaiPathMissing(model(bad)), true, JSON.stringify(bad));
  }
});

test("a complete block is not missing; no drpai block is not missing", async () => {
  const { drpaiPathMissing } = await load();
  assert.equal(
    drpaiPathMissing(
      model({ input_shape: [1, 3], input_name: "in", images: "imgs" }),
    ),
    false,
  );
  assert.equal(
    drpaiPathMissing(
      model({ input_shape: "1,3", input_name: "in", images: "imgs" }),
    ),
    false,
  );
  assert.equal(drpaiPathMissing(model(undefined)), false);
  assert.equal(drpaiPathMissing({ name: "m" }), false);
});

test("deepxPathMissing: missing or non-string paths are missing, not crashes", async () => {
  const { deepxPathMissing } = await load();
  const m = (deepx_dxm1) => ({ name: "m", compile: { deepx_dxm1 } });
  assert.equal(deepxPathMissing(m({})), true);
  assert.equal(deepxPathMissing(m({ config: 1, calibration: "c" })), true);
  assert.equal(deepxPathMissing(m({ config: "a", calibration: " " })), true);
  assert.equal(deepxPathMissing(m({ config: "a", calibration: "c" })), false);
  assert.equal(deepxPathMissing({ name: "m" }), false);
});
