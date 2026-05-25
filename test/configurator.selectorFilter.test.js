const test = require("node:test");
const assert = require("node:assert/strict");
const { filterChoices } = require("../packages/alp-core/dist/configurator/selectorFilter.js");

const ALL = ["etl", "fmt", "cmsis_dsp", "tflite_micro", "mbedtls", "lvgl"];

test("filterChoices excludes selected and matches a query (case-insensitive substring)", () => {
  // "m" is a substring of fmt, cmsis_dsp, tflite_micro, mbedtls; cmsis_dsp is excluded.
  assert.deepEqual(filterChoices(ALL, ["cmsis_dsp"], "M"), ["fmt", "mbedtls", "tflite_micro"]);
});

test("filterChoices: empty query returns all non-selected (sorted)", () => {
  assert.deepEqual(filterChoices(ALL, ["fmt", "etl"], ""), ["cmsis_dsp", "lvgl", "mbedtls", "tflite_micro"]);
});

test("filterChoices: plain substring match", () => {
  assert.deepEqual(filterChoices(ALL, [], "ml"), []); // no id contains "ml"
  assert.deepEqual(filterChoices(ALL, [], "tl"), ["etl", "mbedtls"]); // both contain "tl"
  assert.deepEqual(filterChoices(ALL, [], "cmsis"), ["cmsis_dsp"]);
});
