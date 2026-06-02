const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveProjectContext,
} = require("../packages/alp-core/dist/project/service.js");

test("resolveProjectContext resolves sdk, board yaml, west cwd, and python", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/app"],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "configs/board.yaml",
        westCwd: "",
      },
      platform: "darwin",
    },
    (candidatePath) =>
      candidatePath === "/workspace/alp-sdk/scripts/alp_project.py",
  );

  assert.deepEqual(context, {
    workspaceRoot: "/workspace/app",
    sdkRoot: "/workspace/alp-sdk",
    boardYamlPath: "/workspace/app/configs/board.yaml",
    westCwd: "/workspace/app",
    pythonBinary: "python3",
  });
});

test("resolveProjectContext honors explicit settings", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/app"],
      settings: {
        sdkPath: "/custom/sdk",
        pythonPath: "/custom/python",
        boardYamlPath: "/custom/board.yaml",
        westCwd: "/custom/west",
      },
      platform: "win32",
    },
    (candidatePath) => candidatePath === "/custom/sdk/scripts/alp_project.py",
  );

  assert.equal(context.sdkRoot, "/custom/sdk");
  assert.equal(context.pythonBinary, "/custom/python");
  assert.equal(context.boardYamlPath, "/custom/board.yaml");
  assert.equal(context.westCwd, "/custom/west");
});

test("resolveProjectContext requires alpSdk.path when multiple sdk roots match", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/a", "/workspace/b"],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "linux",
    },
    (candidatePath) =>
      candidatePath === "/workspace/a/scripts/alp_project.py" ||
      candidatePath === "/workspace/alp-sdk/scripts/alp_project.py",
  );

  assert.equal(context.sdkRoot, null);
});
