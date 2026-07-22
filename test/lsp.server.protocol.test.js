// SPDX-License-Identifier: Apache-2.0
//
// Regression guard for the "onDidChangeWorkspaceFolders before request
// handlers silently disables everything registered after it in the same
// tick" bug (see src/lsp/README.md "Gotchas"). Unit tests on service.ts /
// kconfig.ts can't catch this — it's purely a registration-order bug in
// server.ts, so this spawns the real compiled server and speaks LSP over
// stdio, like a real client would.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const SERVER_PATH = path.join(__dirname, "..", "out", "lsp", "server.js");

/** A minimal LSP client: Content-Length framed JSON-RPC over stdio. */
function startClient(cwd) {
  const server = spawn("node", [SERVER_PATH, "--stdio"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 0;
  const notifications = [];

  server.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) {
        return;
      }
      const header = buf.slice(0, sep).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        return;
      }
      const length = Number(match[1]);
      const start = sep + 4;
      if (buf.length < start + length) {
        return;
      }
      const message = JSON.parse(
        buf.slice(start, start + length).toString("utf8"),
      );
      buf = buf.slice(start + length);

      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.id !== undefined && message.method) {
        // Server-initiated request (e.g. client/registerCapability) — a real
        // client always answers these, or the server can be left wedged.
        notifications.push(message);
        send({ jsonrpc: "2.0", id: message.id, result: null });
      } else if (message.method) {
        notifications.push(message);
      }
    }
  });

  function send(message) {
    const body = JSON.stringify(message);
    server.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }

  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  function notify(method, params) {
    send({ jsonrpc: "2.0", method, params });
  }

  return { server, notifications, request, notify };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("LSP server answers completion/hover and publishes diagnostics after didOpen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-lsp-protocol-"));
  const client = startClient(dir);

  try {
    const rootUri = pathToFileURL(dir).href;

    await client.request("initialize", {
      processId: process.pid,
      rootUri,
      capabilities: { workspace: { configuration: true } },
      workspaceFolders: [{ uri: rootUri, name: "w" }],
    });
    client.notify("initialized", {});

    const prjConfUri = pathToFileURL(path.join(dir, "prj.conf")).href;
    const prjConfText = "CONFIG_MAIN_STACK_SIZE=2048\n";
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: prjConfUri,
        languageId: "properties",
        version: 1,
        text: prjConfText,
      },
    });

    const boardYamlUri = pathToFileURL(path.join(dir, "board.yaml")).href;
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: boardYamlUri,
        languageId: "yaml",
        version: 1,
        text: "som:\n  sku: ",
      },
    });

    // Let didOpen-triggered diagnostics + async validation settle.
    await sleep(1000);

    const completion = await client.request("textDocument/completion", {
      textDocument: { uri: prjConfUri },
      position: { line: 0, character: 7 }, // inside "CONFIG_"
    });

    assert.equal(
      completion.error,
      undefined,
      `completion must not error (got ${JSON.stringify(completion.error)})`,
    );
    const items = Array.isArray(completion.result)
      ? completion.result
      : (completion.result?.items ?? []);
    assert.ok(items.length > 0, "expected non-empty completion list");
    assert.ok(
      items.some((item) => item.label.startsWith("CONFIG_")),
      "expected at least one CONFIG_* completion label",
    );

    const hover = await client.request("textDocument/hover", {
      textDocument: { uri: prjConfUri },
      position: { line: 0, character: 12 }, // inside CONFIG_MAIN_STACK_SIZE
    });
    assert.equal(hover.error, undefined, "hover must not error");
    assert.notEqual(hover.result, null, "expected a non-null hover result");
    assert.notEqual(
      hover.result,
      undefined,
      "expected a non-null hover result",
    );

    const diagnosticsNotification = client.notifications.find(
      (note) =>
        note.method === "textDocument/publishDiagnostics" &&
        note.params?.uri === prjConfUri,
    );
    assert.ok(
      diagnosticsNotification,
      "expected a publishDiagnostics notification for prj.conf",
    );
  } finally {
    client.server.kill();
    // Wait for the server to actually exit so Windows releases its handles under
    // `dir` before we remove it (a bare rm races the kill and throws EPERM).
    await new Promise((resolve) => {
      if (client.server.exitCode !== null || client.server.killed === false) {
        // Fall through to the timeout guard if exit never fires.
      }
      client.server.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
    // Best-effort: a passing test must not fail on OS-temp cleanup if a handle
    // is still transiently locked (AV/indexer). The OS reclaims temp regardless.
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch {
      /* leaked temp dir on a locked Windows handle — harmless */
    }
  }
});
