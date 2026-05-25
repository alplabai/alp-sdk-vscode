const test = require("node:test");
const assert = require("node:assert/strict");
const { filterChoices } = require("../packages/alp-core/dist/configurator/selectorFilter.js");

const ALL = ["etl", "fmt", "cmsis_dsp", "tflite_micro", "mbedtls", "lvgl"];

test("filterChoices excludes selected and matches a query (case-insensitive substring)", () => {
  assert.deepEqual(filterChoices(ALL, ["cmsis_dsp"], "M"), ["mbedtls", "tflite_micro"]);
});

test("filterChoices: empty query returns all non-selected (sorted)", () => {
  assert.deepEqual(filterChoices(ALL, ["fmt", "etl"], ""), ["cmsis_dsp", "lvgl", "mbedtls", "tflite_micro"]);
});

test("filterChoices: substring match", () => {
  assert.deepEqual(filterChoices(ALL, [], "ts"), []);
  assert.deepEqual(filterChoices(ALL, [], "tl"), ["etl"]);
  assert.deepEqual(filterChoices(ALL, [], "m"), ["cmsis_dsp", "mbedtls", "tflite_micro"]);
});
