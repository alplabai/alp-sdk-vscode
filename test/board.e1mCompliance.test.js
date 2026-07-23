// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeE1mName,
  checkE1mCompliance,
} = require("@alp-sdk/core/board/e1mCompliance");

const TABLE = {
  family: "aen",
  displayName: "E1M-AEN (Alif Ensemble)",
  pads: [
    {
      e1mPad: "A3",
      e1mFunction: "PWM6",
      owner: "alif",
      siliconPeripheral: "UT3_T1_C",
      siliconPad: "P10_7",
    },
    {
      e1mPad: "AG2",
      e1mFunction: "IO3",
      owner: "alif",
      siliconPeripheral: "GPIO",
      siliconPad: "P3.2",
    },
    {
      e1mPad: "A14",
      e1mFunction: "ANA_S2",
      owner: "alif",
      siliconPeripheral: "ANA_S2",
      siliconPad: "P0_2",
    },
    {
      e1mPad: "A7",
      e1mFunction: "ENC3_X",
      owner: "alif",
      siliconPeripheral: "QEC3_X_A",
      siliconPad: "P4_1",
    },
    {
      e1mPad: "B7",
      e1mFunction: "ENC3_Y",
      owner: "alif",
      siliconPeripheral: "QEC3_Y_A",
      siliconPad: "P4_2",
    },
  ],
};

function boardWith(routes, pins) {
  return { som: { sku: "E1M-AEN801" }, cores: {}, e1m_routes: routes, pins };
}

test("normalizeE1mName handles primary, GPIO-secondary, X-connector and ADC forms", () => {
  assert.deepStrictEqual(normalizeE1mName("E1M_PWM6"), {
    fn: "PWM6",
    gpioSecondary: false,
  });
  assert.deepStrictEqual(normalizeE1mName("E1M_GPIO_PWM6"), {
    fn: "PWM6",
    gpioSecondary: true,
  });
  assert.deepStrictEqual(normalizeE1mName("E1M_X_UART2"), {
    fn: "UART2",
    gpioSecondary: false,
  });
  assert.deepStrictEqual(normalizeE1mName("E1M_ADC2"), {
    fn: "ANA_S2",
    gpioSecondary: false,
  });
  assert.strictEqual(normalizeE1mName("not-a-pad"), null);
});

test("valid references produce no issues", () => {
  const cfg = boardWith(
    {
      pwm: [{ e1m: "E1M_PWM6", macro: "LED" }],
      gpio: [{ e1m: "E1M_GPIO_IO3", macro: "BTN" }],
    },
    ["E1M_ADC2"],
  );
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
});

test("unknown function on the family is an error", () => {
  const cfg = boardWith(
    { pwm: [{ e1m: "E1M_PWM9", macro: "LED" }] },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "error");
  assert.strictEqual(issues[0].token, "E1M_PWM9");
  assert.match(issues[0].message, /not available/);
  assert.match(issues[0].message, /aen/);
});

test("two references claiming the same pad is an error", () => {
  const cfg = boardWith(
    {
      pwm: [{ e1m: "E1M_PWM6", macro: "LED" }],
      gpio: [{ e1m: "E1M_GPIO_PWM6", macro: "BTN" }],
    },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "error");
  // gpio section is collected before pwm, so the pwm entry is the second claimer.
  assert.strictEqual(issues[0].token, "E1M_PWM6");
  assert.match(issues[0].message, /A3/);
  assert.match(issues[0].message, /E1M_GPIO_PWM6/);
  assert.match(issues[0].message, /one owner per pad/);
});

test("prefix functions claim all matching pads (ENC3 takes X and Y)", () => {
  const cfg = boardWith(
    {
      qenc: [{ e1m: "E1M_ENC3", macro: "WHEEL" }],
      gpio: [{ e1m: "E1M_GPIO_ENC3_X", macro: "BTN" }],
    },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.match(issues[0].message, /A7/);
});

test("pins accepts bare strings and objects", () => {
  const cfg = boardWith(undefined, ["E1M_PWM9", { e1m: "E1M_GPIO_IO3" }]);
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].token, "E1M_PWM9");
});

test("malformed names and empty config are ignored", () => {
  const cfg = boardWith(
    { gpio: [{ e1m: "TOTALLY_WRONG", macro: "X" }] },
    undefined,
  );
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
  assert.deepStrictEqual(
    checkE1mCompliance({ som: { sku: "E1M-AEN801" }, cores: {} }, TABLE),
    [],
  );
});

test("non-array pins never throws and yields no issues", () => {
  const cfg = { som: { sku: "E1M-AEN801" }, cores: {}, pins: 42 };
  assert.doesNotThrow(() => checkE1mCompliance(cfg, TABLE));
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
});

test("non-array route section never throws and yields no issues", () => {
  const cfg = { som: { sku: "E1M-AEN801" }, cores: {}, e1m_routes: { pwm: 5 } };
  assert.doesNotThrow(() => checkE1mCompliance(cfg, TABLE));
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
});

test("identical-token double-claim of one physical pad is flagged (R2)", () => {
  const cfg = boardWith(
    {
      pwm: [
        { e1m: "E1M_PWM6", macro: "LED" },
        { e1m: "E1M_PWM6", macro: "FAN" },
      ],
    },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "error");
  assert.match(issues[0].message, /A3/);
  assert.match(issues[0].message, /one owner per pad/);
});
