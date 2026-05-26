const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createModuleScaffoldPlan,
  createModuleScaffoldPreviewMarkdown,
  createTemplateExplanation,
  createWizardPlan,
  createWizardPreviewMarkdown,
  createWizardValidationSummary,
  listModuleTemplates,
  listWizardTemplates,
  suggestTemplateIdFromBoardModel,
} = require("@alp-sdk/core/wizard/service");

test("listWizardTemplates includes expected starter catalog", () => {
  const templates = listWizardTemplates();

  assert.deepEqual(
    templates.map((template) => template.id),
    [
      "minimal-app",
      "sensor-starter",
      "iot-starter",
      "edge-ai-starter",
      "board-diagnostics",
    ],
  );
});

test("listModuleTemplates includes expected module catalog", () => {
  const templates = listModuleTemplates();

  assert.deepEqual(
    templates.map((template) => template.id),
    [
      "sensor-driver",
      "connectivity-service",
      "inference-stage",
      "diagnostics-check",
    ],
  );
});

test("createWizardPlan builds starter files and scaffold preview", () => {
  const plan = createWizardPlan({
    templateId: "iot-starter",
    somSku: "E1M-AEN701",
    carrierName: "E1M-EVK",
    os: "zephyr",
    features: { wifi: true, mqtt: true, ble: false, tls: true },
    libraries: ["fmt", "mbedtls"],
  });

  assert.equal(plan.boardModel.som.sku, "E1M-AEN701");
  assert.equal(plan.boardModel.carrier.name, "E1M-EVK");
  assert.equal(plan.boardModel.os, "zephyr");
  assert.equal(plan.files.length >= 7, true);
  assert.match(plan.scaffoldTreePreview, /board\.yaml/);
  assert.match(plan.scaffoldTreePreview, /src\/main\.c/);
  assert.match(plan.scaffoldTreePreview, /prj\.conf/);
  assert.match(
    plan.scaffoldTreePreview,
    /src\/features\/connectivity_pipeline\.c/,
  );

  const boardYaml = plan.files.find(
    (file) => file.relativePath === "board.yaml",
  );
  assert.ok(boardYaml);
  assert.match(boardYaml.content, /schema_version: 1/);
  assert.match(boardYaml.content, /mqtt: true/);

  const prjConf = plan.files.find((file) => file.relativePath === "prj.conf");
  assert.ok(prjConf);
  assert.match(prjConf.content, /CONFIG_MQTT_LIB=y/);

  const rootCmake = plan.files.find(
    (file) => file.relativePath === "CMakeLists.txt",
  );
  assert.ok(rootCmake);
  assert.match(rootCmake.content, /add_subdirectory\(src\)/);
});

test("createWizardPreviewMarkdown contains selections and file change summary", () => {
  const plan = createWizardPlan({
    templateId: "minimal-app",
    somSku: "E1M-AEN701",
    carrierName: "E1M-EVK",
    os: "zephyr",
    features: { wifi: false, mqtt: false, ble: false, tls: false },
    libraries: [],
  });

  const markdown = createWizardPreviewMarkdown(
    plan,
    [
      { relativePath: "board.yaml", kind: "new" },
      { relativePath: "README.md", kind: "update" },
      { relativePath: "CMakeLists.txt", kind: "unchanged" },
    ],
    [
      {
        emit: "zephyr-conf",
        displayName: "Zephyr config",
        outputRelativePath: "build/generated/alp.conf",
        languageId: "properties",
        state: "missing",
        contentPreview: "(Not generated yet)",
      },
    ],
  );

  assert.match(markdown, /ALP Project Wizard Preview/);
  assert.match(markdown, /Template: Minimal app/);
  assert.match(markdown, /Files that will be written: 2/);
  assert.match(markdown, /NEW: board\.yaml/);
  assert.match(markdown, /UPDATE: README\.md/);
  assert.match(markdown, /Validation Summary/);
  assert.match(markdown, /Errors: 0 \| Warnings: 0 \| Suggestions: 0/);
  assert.match(markdown, /Starter Code Explanation/);
  assert.match(markdown, /Generated Output Preview/);
  assert.match(markdown, /Zephyr config/);
  assert.match(markdown, /build\/generated\/alp\.conf/);
});

test("createWizardValidationSummary reports required-field errors", () => {
  const summary = createWizardValidationSummary({
    schema_version: 1,
    som: { sku: "" },
    carrier: { name: "" },
    os: "",
  });

  assert.equal(summary.errors.length, 3);
  assert.match(summary.errors[0], /SoM SKU is required/);
  assert.match(summary.errors[1], /Carrier name is required/);
  assert.match(summary.errors[2], /OS target is required/);
});

test("suggestTemplateIdFromBoardModel infers templates from existing config", () => {
  assert.equal(
    suggestTemplateIdFromBoardModel({
      schema_version: 1,
      som: { sku: "E1M-AEN701" },
      carrier: { name: "E1M-EVK" },
      os: "zephyr",
      diagnostics: { last_error: true, log_level: "debug" },
    }),
    "board-diagnostics",
  );

  assert.equal(
    suggestTemplateIdFromBoardModel({
      schema_version: 1,
      som: { sku: "E1M-AEN701" },
      carrier: { name: "E1M-EVK" },
      os: "zephyr",
      inference: { backend: "auto" },
    }),
    "edge-ai-starter",
  );

  assert.equal(
    suggestTemplateIdFromBoardModel({
      schema_version: 1,
      som: { sku: "E1M-AEN701" },
      carrier: { name: "E1M-EVK" },
      os: "zephyr",
      iot: { wifi: true, mqtt: true },
    }),
    "iot-starter",
  );
});

test("createTemplateExplanation returns non-empty guidance", () => {
  const explanation = createTemplateExplanation("minimal-app");
  assert.equal(explanation.length >= 1, true);
  assert.match(explanation[0], /template/i);
});

test("createModuleScaffoldPlan generates files for existing project modules", () => {
  const plan = createModuleScaffoldPlan({
    templateId: "sensor-driver",
    moduleName: "Thermal Sensor",
    boardModel: {
      schema_version: 1,
      som: { sku: "E1M-AEN701" },
      carrier: { name: "E1M-EVK" },
      os: "zephyr",
    },
  });

  assert.equal(plan.normalizedModuleName, "thermal_sensor");
  assert.equal(plan.files.length, 3);
  assert.match(plan.scaffoldTreePreview, /include\/modules\/thermal_sensor\.h/);
  assert.match(
    plan.scaffoldTreePreview,
    /src\/modules\/thermal_sensor\/thermal_sensor\.c/,
  );

  const sourceFile = plan.files.find((file) =>
    file.relativePath.endsWith(".c"),
  );
  assert.ok(sourceFile);
  assert.match(sourceFile.content, /Board context: E1M-AEN701 \/ zephyr/);
});

test("createModuleScaffoldPreviewMarkdown includes notes and file change summary", () => {
  const plan = createModuleScaffoldPlan({
    templateId: "diagnostics-check",
    moduleName: "board health",
    boardModel: null,
  });

  const markdown = createModuleScaffoldPreviewMarkdown(plan, [
    { relativePath: "include/modules/board_health.h", kind: "new" },
    { relativePath: "src/modules/board_health/board_health.c", kind: "update" },
  ]);

  assert.match(markdown, /ALP Module Scaffold Preview/);
  assert.match(markdown, /Template: Diagnostics check module/);
  assert.match(markdown, /Files that will be written: 2/);
  assert.match(markdown, /NEW: include\/modules\/board_health\.h/);
  assert.match(markdown, /UPDATE: src\/modules\/board_health\/board_health\.c/);
  assert.match(markdown, /Module Notes/);
});
