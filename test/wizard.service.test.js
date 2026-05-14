const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWizardPlan,
  createWizardPreviewMarkdown,
  listWizardTemplates,
} = require("../out/wizard/service.js");

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
  assert.equal(plan.files.length, 4);
  assert.match(plan.scaffoldTreePreview, /board\.yaml/);
  assert.match(plan.scaffoldTreePreview, /src\/main\.c/);

  const boardYaml = plan.files.find((file) => file.relativePath === "board.yaml");
  assert.ok(boardYaml);
  assert.match(boardYaml.content, /schema_version: 1/);
  assert.match(boardYaml.content, /mqtt: true/);
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

  const markdown = createWizardPreviewMarkdown(plan, [
    { relativePath: "board.yaml", kind: "new" },
    { relativePath: "README.md", kind: "update" },
    { relativePath: "CMakeLists.txt", kind: "unchanged" },
  ]);

  assert.match(markdown, /ALP Project Wizard Preview/);
  assert.match(markdown, /Template: Minimal app/);
  assert.match(markdown, /Files that will be written: 2/);
  assert.match(markdown, /NEW: board\.yaml/);
  assert.match(markdown, /UPDATE: README\.md/);
});
