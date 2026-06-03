const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectRuntimeCapabilitiesFromCommands,
  createDebugWorkspaceContext,
} = require("../packages/alp-core/dist/debug/adapterCore.js");

function createProjectContext(overrides = {}) {
  return {
    workspaceRoot: "/workspace/app",
    sdkRoot: "/workspace/sdk",
    boardYamlPath: "/workspace/app/board.yaml",
    westCwd: "/workspace/app",
    pythonBinary: "python3",
    ...overrides,
  };
}

test("createDebugWorkspaceContext enriches project context with runtime state", () => {
  const context = createDebugWorkspaceContext(createProjectContext(), {
    generatedAt: "2026-05-14T00:00:00.000Z",
    boardYamlExists: (path) => path === "/workspace/app/board.yaml",
    debuggerExtensions: {
      cortexDebug: true,
      cppTools: false,
      codeLLDB: true,
    },
  });

  assert.deepEqual(context, {
    generatedAt: "2026-05-14T00:00:00.000Z",
    workspaceRoot: "/workspace/app",
    sdkRoot: "/workspace/sdk",
    boardYamlPath: "/workspace/app/board.yaml",
    boardYamlExists: true,
    westCwd: "/workspace/app",
    pythonBinary: "python3",
    debuggerExtensions: {
      cortexDebug: true,
      cppTools: false,
      codeLLDB: true,
    },
  });
});

test("createDebugWorkspaceContext handles missing board yaml path", () => {
  const context = createDebugWorkspaceContext(
    createProjectContext({ boardYamlPath: null }),
    {
      generatedAt: "2026-05-14T00:00:00.000Z",
      boardYamlExists: () => true,
      debuggerExtensions: {
        cortexDebug: false,
        cppTools: false,
        codeLLDB: false,
      },
    },
  );

  assert.equal(context.boardYamlExists, false);
});

test("collectRuntimeCapabilitiesFromCommands picks the first supported executables", () => {
  const available = new Set([
    "python3",
    "JLinkGDBServer",
    "arm-none-eabi-gdb",
    "lldb",
  ]);
  const runtime = collectRuntimeCapabilitiesFromCommands(
    createProjectContext(),
    (command) => available.has(command),
  );

  assert.deepEqual(runtime, {
    pythonAvailable: true,
    jlinkExecutable: "JLinkGDBServer",
    openOcdExecutable: null,
    pyocdExecutable: null,
    gdbExecutable: "arm-none-eabi-gdb",
    lldbExecutable: "lldb",
  });
});
