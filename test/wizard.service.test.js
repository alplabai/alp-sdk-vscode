const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createModuleScaffoldPlan,
  createModuleScaffoldPreviewMarkdown,
  listModuleTemplates,
} = require("../packages/alp-core/dist/wizard/service.js");

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

test("createModuleScaffoldPlan generates files for existing project modules", () => {
  const plan = createModuleScaffoldPlan({
    templateId: "sensor-driver",
    moduleName: "Thermal Sensor",
    boardModel: {
      schema_version: 1,
      som: { sku: "E1M-AEN801" },
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
  assert.match(sourceFile.content, /Board context: E1M-AEN801 \/ zephyr/);
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

  assert.match(markdown, /Alp Module Scaffold Preview/);
  assert.match(markdown, /Template: Diagnostics check module/);
  assert.match(markdown, /Files that will be written: 2/);
  assert.match(markdown, /NEW: include\/modules\/board_health\.h/);
  assert.match(markdown, /UPDATE: src\/modules\/board_health\/board_health\.c/);
  assert.match(markdown, /Module Notes/);
});
