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
      // POSIX-style fixture paths below → declare a POSIX platform so path
      // semantics match on any host (this test is about explicit settings, not
      // Windows path behaviour).
      platform: "linux",
    },
    (candidatePath) => candidatePath === "/custom/sdk/scripts/alp_project.py",
  );

  assert.equal(context.sdkRoot, "/custom/sdk");
  assert.equal(context.pythonBinary, "/custom/python");
  assert.equal(context.boardYamlPath, "/custom/board.yaml");
  assert.equal(context.westCwd, "/custom/west");
});

test("resolveProjectContext falls back to the newest installed SDK in the cache", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: [],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "darwin",
      installedSdkRoots: ["/home/u/.alp/sdk/v0.6.0", "/home/u/.alp/sdk/v0.5.0"],
    },
    (candidatePath) =>
      candidatePath === "/home/u/.alp/sdk/v0.6.0/scripts/alp_project.py" ||
      candidatePath === "/home/u/.alp/sdk/v0.5.0/scripts/alp_project.py",
  );

  assert.equal(context.sdkRoot, "/home/u/.alp/sdk/v0.6.0");
});

test("resolveProjectContext prefers a sibling SDK over the cache fallback", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/app"],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "linux",
      installedSdkRoots: ["/home/u/.alp/sdk/v0.6.0"],
    },
    (candidatePath) =>
      candidatePath === "/workspace/alp-sdk/scripts/alp_project.py" ||
      candidatePath === "/home/u/.alp/sdk/v0.6.0/scripts/alp_project.py",
  );

  assert.equal(context.sdkRoot, "/workspace/alp-sdk");
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

test("resolveProjectContext targets the multi-root folder holding board.yaml", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/docs", "/workspace/firmware"],
      settings: {
        sdkPath: "/custom/sdk",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "linux",
    },
    (candidatePath) =>
      candidatePath === "/workspace/firmware/board.yaml" ||
      candidatePath === "/custom/sdk/scripts/alp_project.py",
  );

  assert.equal(context.workspaceRoot, "/workspace/firmware");
  assert.equal(context.boardYamlPath, "/workspace/firmware/board.yaml");
  assert.equal(context.westCwd, "/workspace/firmware");
});

test("resolveProjectContext honors a .alp/sdk-path pointer when alpSdk.path is unset", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/app"],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "linux",
    },
    (candidatePath) =>
      candidatePath === "/workspace/app/.alp/sdk-path" ||
      candidatePath === "/opt/alp-sdk/scripts/alp_project.py",
    (candidatePath) =>
      candidatePath === "/workspace/app/.alp/sdk-path"
        ? JSON.stringify({ sdkPath: "/opt/alp-sdk" })
        : "",
  );

  assert.equal(context.sdkRoot, "/opt/alp-sdk");
});

test("resolveProjectContext ignores a stale .alp/sdk-path pointer and auto-discovers", () => {
  const context = resolveProjectContext(
    {
      workspaceFolders: ["/workspace/app"],
      settings: {
        sdkPath: "",
        pythonPath: "",
        boardYamlPath: "board.yaml",
        westCwd: "",
      },
      platform: "linux",
    },
    (candidatePath) =>
      candidatePath === "/workspace/app/.alp/sdk-path" ||
      candidatePath === "/workspace/alp-sdk/scripts/alp_project.py",
    (candidatePath) =>
      candidatePath === "/workspace/app/.alp/sdk-path"
        ? JSON.stringify({ sdkPath: "/stale/sdk" })
        : "",
  );

  assert.equal(context.sdkRoot, "/workspace/alp-sdk");
});
