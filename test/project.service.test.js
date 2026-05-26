const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveProjectContext } = require("@alp-sdk/core/project/service");

// The service composes paths with Node's `path` module, so expectations are
// built the same way to stay correct on both POSIX and Windows separators.
test("resolveProjectContext resolves sdk, board yaml, west cwd, and python", () => {
  const siblingSdk = path.resolve("/workspace/app", "..", "alp-sdk");
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
      candidatePath === path.join(siblingSdk, "scripts", "alp_project.py"),
  );

  assert.deepEqual(context, {
    workspaceRoot: "/workspace/app",
    sdkRoot: siblingSdk,
    boardYamlPath: path.join("/workspace/app", "configs/board.yaml"),
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
    (candidatePath) =>
      candidatePath === path.join("/custom/sdk", "scripts", "alp_project.py"),
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
