// SPDX-License-Identifier: Apache-2.0
//
// The serial monitor's terminal name is keyed on the PORT (#552).
//
// ── The defect this pins ────────────────────────────────────────────────────
//
// `runInTerminal` (`src/util.ts`) does not reuse a pane. It REFUSES a second
// run whose name is already active:
//
//   "<name>" is still running — wait for it to finish before starting it again.
//
// keyed on `isRunActive(options.name)` and nothing else. So the terminal name
// is the concurrency key, and choosing it is a design decision rather than a
// label.
//
// The first draft of this feature used one fixed "Alp Monitor". That is right
// about one thing — two readers on ONE serial device race over the bytes
// rather than showing two views of them — and wrong about the board this
// feature was filed for. The AEN801 has TWO consoles: the app console on UART5
// and the SE-UART, a different device that also runs at a different rate
// (57600 against 115200). A fixed name makes watching both at once impossible,
// and it fails in the quietest possible way: the second click pops a "still
// running" warning naming a terminal that is watching a different port.
//
// Keyed on the port, both properties hold at once.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load the compiled monitor module with `vscode` stubbed out — it is imported
 *  at module scope and does not exist outside the extension host. */
function loadMonitor() {
  const modPath = require.resolve(path.join(root, "out", "monitor.js"));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") {
      return {
        window: {
          showQuickPick: async () => undefined,
          createOutputChannel: () => ({
            appendLine() {},
            append() {},
            show() {},
            clear() {},
            dispose() {},
          }),
          showWarningMessage: async () => undefined,
          showErrorMessage: async () => undefined,
          onDidCloseTerminal: () => ({ dispose() {} }),
          terminals: [],
        },
        tasks: {
          onDidEndTaskProcess: () => ({ dispose() {} }),
          onDidStartTaskProcess: () => ({ dispose() {} }),
          taskExecutions: [],
        },
        workspace: {
          getConfiguration: () => ({ get: () => undefined }),
          workspaceFolders: undefined,
          onDidChangeConfiguration: () => ({ dispose() {} }),
        },
        commands: { registerCommand: () => ({ dispose() {} }) },
        Uri: { file: (p) => ({ fsPath: p }) },
        EventEmitter: class {
          constructor() {
            this.event = () => ({ dispose() {} });
          }
          fire() {}
          dispose() {}
        },
      };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

test("two different ports get two different terminal names", () => {
  const { monitorRunName } = loadMonitor();
  const appConsole = monitorRunName("/dev/ttyUSB2");
  const seUart = monitorRunName("/dev/ttyUSB1");
  assert.notEqual(
    appConsole,
    seUart,
    "the AEN801's app console (UART5) and SE-UART are two devices on one " +
      "board. A shared name makes `runInTerminal` refuse the second with " +
      '`"<name>" is still running`, naming a terminal on the other port.',
  );
});

test("the same port gets the same name, so a second reader is refused", () => {
  const { monitorRunName } = loadMonitor();
  assert.equal(
    monitorRunName("/dev/ttyUSB1"),
    monitorRunName("/dev/ttyUSB1"),
    "`isRunActive` matches on the exact name, so a stable name per port is " +
      "what makes two readers on ONE device impossible — that pair races " +
      "over the bytes rather than showing two views of them",
  );
});

test("the port is present in the name a user reads", () => {
  const { monitorRunName } = loadMonitor();
  const name = monitorRunName("/dev/cu.usbmodem14201");
  assert.match(
    name,
    /\/dev\/cu\.usbmodem14201/,
    "the refusal message quotes the terminal name verbatim; a name without " +
      "the port cannot tell the user WHICH console is already open",
  );
  assert.match(name, /Alp/, "it must still read as an Alp terminal");
});

test("a Windows COM port survives the name unaltered", () => {
  const { monitorRunName } = loadMonitor();
  assert.match(
    monitorRunName("COM7"),
    /COM7/,
    "tan's own --port help names `COM7` first; the name must not be POSIX-only",
  );
});
