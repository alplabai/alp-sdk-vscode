// SPDX-License-Identifier: Apache-2.0
//
// The port list `tan monitor` hands back, narrowed (#552).
//
// The payload in `MEASURED_PAYLOAD` is not invented. It is the verbatim `data`
// of `tan monitor --format json` run with no `--port` against the pinned tan
// `0.6.0` on a developer macOS host, and it is here because of what it
// contains: five ports, none of which is a board. Three are Bluetooth audio
// devices. A picker that defaulted to the first would have opened a session
// against `/dev/cu.debug-console`.
//
// That is the same trap with a worse ending on the AEN801 bench, where
// `/dev/ttyACM0` is the DPS-150 programmable power supply rather than a
// console. So "never pick for the user" is a property this file pins, not a
// preference.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MONITOR_NO_PORT_CODE,
  MONITOR_PORTS_SHAPE,
  DEFAULT_MONITOR_BAUD,
  MONITOR_BAUD_CHOICES,
  narrowSerialPorts,
  isValidBaud,
} = require("../packages/alp-core/dist/monitor/ports.js");

/** Verbatim `data` from the measured run described above. */
const MEASURED_PAYLOAD = Object.freeze({
  schemaVersion: "1",
  availablePorts: [
    { device: "/dev/cu.debug-console", description: "n/a" },
    { device: "/dev/cu.Bluetooth-Incoming-Port", description: "n/a" },
    { device: "/dev/cu.soundcoreR50i", description: "n/a" },
    { device: "/dev/cu.HUAWEIFreeBuds6i", description: "n/a" },
    { device: "/dev/cu.MixPodsPro", description: "n/a" },
  ],
});

// ---------------------------------------------------------------------------
// The measured payload
// ---------------------------------------------------------------------------

test("the measured tan payload narrows to every port it listed", () => {
  const ports = narrowSerialPorts(MEASURED_PAYLOAD.availablePorts);
  assert.equal(ports.length, 5, "a real payload lost entries in narrowing");
  assert.deepEqual(
    ports.map((p) => p.device),
    [
      "/dev/cu.debug-console",
      "/dev/cu.Bluetooth-Incoming-Port",
      "/dev/cu.soundcoreR50i",
      "/dev/cu.HUAWEIFreeBuds6i",
      "/dev/cu.MixPodsPro",
    ],
    "order is preserved: tan's order is the only ordering signal there is",
  );
  assert.equal(ports[0].description, "n/a", "tan's own word is passed through");
});

test("the shape constant names the field the narrower actually reads", () => {
  assert.deepEqual(
    Object.keys(MONITOR_PORTS_SHAPE),
    ["availablePorts"],
    "the shape check and the reader must name the same field, or the check " +
      "passes while the reader gets undefined — the exact failure " +
      "`tanPayloadShape.ts` exists to convert into a message",
  );
  assert.equal(MONITOR_PORTS_SHAPE.availablePorts, "array");
});

test("the refusal code is classified on the code, not the prose", () => {
  assert.equal(MONITOR_NO_PORT_CODE, "monitor.no-port");
});

// ---------------------------------------------------------------------------
// Drop, never coerce
// ---------------------------------------------------------------------------

test("an entry with no usable device is dropped, not repaired", () => {
  const ports = narrowSerialPorts([
    { device: "/dev/ttyUSB0", description: "FT232R" },
    { description: "no device at all" },
    { device: "", description: "empty" },
    { device: "   ", description: "whitespace only" },
    { device: 42, description: "a number" },
    { device: null, description: "null" },
  ]);
  assert.deepEqual(
    ports.map((p) => p.device),
    ["/dev/ttyUSB0"],
    "the only repair available would be to invent a device path, and a " +
      "picker row naming a port that does not exist is worse than a short list",
  );
});

test("a non-string description becomes null, never a stringified object", () => {
  const ports = narrowSerialPorts([
    { device: "/dev/ttyACM0", description: { vendor: "Alif" } },
    { device: "/dev/ttyACM1" },
    { device: "/dev/ttyACM2", description: 115200 },
  ]);
  assert.deepEqual(
    ports.map((p) => p.description),
    [null, null, null],
    "stringifying would print `[object Object]` beside a real port",
  );
  assert.equal(
    ports.length,
    3,
    "a bad description must not cost the port itself — the device is the " +
      "part the user needs and it was fine",
  );
});

test("a non-array payload yields no ports rather than throwing", () => {
  for (const value of [null, undefined, {}, "ports", 0, false]) {
    assert.deepEqual(
      narrowSerialPorts(value),
      [],
      `narrowSerialPorts(${JSON.stringify(value)}) must not throw`,
    );
  }
});

test("a nested array is not mistaken for a port entry", () => {
  assert.deepEqual(narrowSerialPorts([["/dev/ttyUSB0"]]), []);
});

// ---------------------------------------------------------------------------
// Baud
// ---------------------------------------------------------------------------

test("the offered rates include tan's default and the AEN SE-UART rate", () => {
  const rates = MONITOR_BAUD_CHOICES.map((c) => c.baud);
  assert.ok(
    rates.includes(DEFAULT_MONITOR_BAUD),
    "the preselected rate must be offered",
  );
  assert.equal(DEFAULT_MONITOR_BAUD, 115200, "tan's documented default");
  assert.ok(
    rates.includes(57600),
    "the AEN SE-UART runs at 57600; picking that device at tan's default " +
      "115200 produces silence, which reads as a dead board",
  );
});

test("both rates that can be silently wrong carry a note", () => {
  for (const baud of [57600, 115200]) {
    const choice = MONITOR_BAUD_CHOICES.find((c) => c.baud === baud);
    assert.ok(choice, `${baud} is not offered`);
    assert.ok(
      choice.note && choice.note.length > 0,
      `${baud} has no note — the note is the reason this is a picker and ` +
        "not a fixed value",
    );
  }
});

test("isValidBaud accepts only a positive integer", () => {
  for (const good of [9600, 57600, 115200, 921600, 1]) {
    assert.equal(isValidBaud(good), true, `${good} should be accepted`);
  }
  for (const bad of [0, -1, -115200, 1.5, NaN, Infinity, -Infinity]) {
    assert.equal(isValidBaud(bad), false, `${bad} should be refused`);
  }
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the drop assertions are not passing on an empty result by accident", () => {
  assert.ok(
    narrowSerialPorts(MEASURED_PAYLOAD.availablePorts).length > 0,
    "every drop assertion above compares against a short list; if the " +
      "narrower dropped everything they would all still pass",
  );
  assert.ok(
    MONITOR_BAUD_CHOICES.length >= 2,
    "an emptied choice list satisfies the `includes` assertions vacuously",
  );
});
