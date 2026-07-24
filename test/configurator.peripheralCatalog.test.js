const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Mirrors PERIPHERAL_CHOICES in ConfiguratorView.tsx (packages/alp-webview/src/
// features/configurator/ConfiguratorView.tsx). That package doesn't depend on
// @alp-sdk/core (the webview<->core boundary is manually synced by convention,
// see that file's header comments on librariesForCore), so this list is
// hand-mirrored here rather than imported -- this test is the drift guard
// that catches the two falling out of sync.
const UI_PERIPHERAL_CHOICES = [
  "adc",
  "can",
  "counter",
  "emmc",
  "ethernet",
  "flash",
  "gpio",
  "i2c",
  "i2s",
  "pwm",
  "rtc",
  "sensor",
  "spi",
  "uart",
  "usb",
  "watchdog",
];

test("ConfiguratorView PERIPHERAL_CHOICES matches the vendored schema's core_entry.peripherals enum (drift guard)", () => {
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  const schemaEnum =
    schema.$defs?.core_entry?.properties?.peripherals?.items?.enum;
  assert.ok(
    Array.isArray(schemaEnum) && schemaEnum.length > 0,
    "schemas/board.schema.json $defs.core_entry.properties.peripherals.items.enum must exist",
  );
  assert.deepEqual(
    [...UI_PERIPHERAL_CHOICES].sort(),
    [...schemaEnum].sort(),
    "PERIPHERAL_CHOICES in ConfiguratorView.tsx has drifted from schemas/board.schema.json's " +
      "$defs.core_entry.properties.peripherals.items.enum -- update the UI array (and this " +
      "test's UI_PERIPHERAL_CHOICES mirror) to match. Note: if the drift is because the SCHEMA " +
      "enum is narrower than real SDK capability, widening it is an alp-sdk change, out of " +
      "scope for this repo.",
  );
});
