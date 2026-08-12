// The VS Code half of #493: handing `redhat.vscode-yaml` the resolved SDK's
// schema, and getting out of the way when there is not one.
//
// vscode-yaml's contract is what makes these worth asserting, and none of it is
// visible from the call site:
//   * `requestSchema` is invoked SYNCHRONOUSLY, so an async answer silently
//     disables the whole feature while looking registered;
//   * ANY truthy answer replaces the static `contributes.yamlValidation`
//     association outright, so answering for the wrong document hijacks it;
//   * an empty answer, and a THROWN one, both fall back to that static
//     association -- which is what keeps the bundled copies reachable.
const test = require("node:test");
const assert = require("node:assert/strict");
const realFs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load `out/<rel>.js` with `stubs` standing in for the requires named. */
function load(rel, stubs) {
  const modPath = require.resolve(path.join(root, "out", `${rel}.js`));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

const BOARD = realFs.readFileSync(
  path.join(root, "schemas", "board.schema.json"),
  "utf-8",
);
const MANIFEST = realFs.readFileSync(
  path.join(root, "schemas", "system-manifest-v1.schema.json"),
  "utf-8",
);

/** What `readSdkSchemas()` would return for an SDK shipping `files`. */
function snapshotOf(sdkRoot, files) {
  if (sdkRoot === null) {
    return { sdkRoot: null, sdkVersion: null, sdkReads: {} };
  }
  const sdkReads = {};
  for (const id of ["board", "systemManifest"]) {
    sdkReads[id] =
      files[id] === undefined
        ? { ok: false, reason: "ENOENT" }
        : { ok: true, text: files[id] };
  }
  return { sdkRoot, sdkVersion: "0.15.0", sdkReads };
}

/**
 * @param opts.snapshot         what `readSdkSchemas()` reports
 * @param opts.yamlApi          `false` for a missing extension, or an api object
 * @param opts.registerReturns  what `registerContributor` answers
 */
function harness(opts = {}) {
  const logs = [];
  const listeners = [];
  const registrations = [];
  let snapshot = opts.snapshot ?? snapshotOf(null, {});

  const api =
    opts.yamlApi === undefined
      ? {
          registerContributor: (...args) => {
            registrations.push(args);
            return opts.registerReturns ?? true;
          },
        }
      : opts.yamlApi;

  const mod = load("yamlSchemaContributor", {
    vscode: {
      extensions: {
        getExtension: (id) =>
          api === false ? undefined : { id, activate: async () => api },
      },
      Disposable: class {
        constructor(fn) {
          this.dispose = fn;
        }
      },
    },
    "./schemaProvenance": { readSdkSchemas: () => snapshot },
    "./util": { log: (message, level) => logs.push({ message, level }) },
  });

  const stateMgr = {
    onStateChange: (fn) => {
      listeners.push(fn);
      return { dispose: () => listeners.splice(listeners.indexOf(fn), 1) };
    },
  };

  const disposable = mod.createSdkSchemaContributor(stateMgr);
  return {
    mod,
    logs,
    listeners,
    registrations,
    disposable,
    /** Swap the resolved SDK, then fire the refresh the way StateManager does. */
    set: (next) => {
      snapshot = next;
      listeners.forEach((fn) => fn());
    },
    get requestSchema() {
      return registrations[0]?.[1];
    },
    get requestSchemaContent() {
      return registrations[0]?.[2];
    },
  };
}

/** `await` one macrotask turn so the fire-and-forget registration has run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("registers under the alp-schema scheme, with no label argument", async () => {
  // Arrange / Act
  const h = harness();
  await settle();

  // Assert -- vscode-yaml turns `label` into a regex it matches against the
  // DOCUMENT TEXT, which would tie schema selection to file contents.
  assert.equal(h.registrations.length, 1);
  const [scheme, requestSchema, requestSchemaContent, label] =
    h.registrations[0];
  assert.equal(scheme, "alp-schema");
  assert.equal(typeof requestSchema, "function");
  assert.equal(typeof requestSchemaContent, "function");
  assert.equal(label, undefined);
});

test("with no SDK resolved it answers undefined, so the bundled copy is used", async () => {
  // Arrange -- the common first-run state, and the path the issue requires to
  // stay genuinely reachable.
  const h = harness();
  await settle();

  // Act / Assert
  assert.equal(h.requestSchema("file:///w/board.yaml"), undefined);
  assert.equal(h.requestSchema("file:///w/system-manifest.yaml"), undefined);
});

test("the answer is a plain string, not a promise", async () => {
  // Arrange -- dispatch is `r = requestSchema(e); r && t.push(r)`. A promise is
  // truthy, so an async callback would push a Promise as if it were a uri and
  // break validation while looking perfectly registered.
  const h = harness({ snapshot: snapshotOf("/opt/sdk", { board: BOARD }) });
  await settle();

  // Act
  const answer = h.requestSchema("file:///w/board.yaml");

  // Assert
  assert.equal(typeof answer, "string");
  assert.ok(!(answer instanceof Promise));
});

test("a resolved SDK is served, and its exact bytes come back by uri", async () => {
  // Arrange
  const h = harness({
    snapshot: snapshotOf("/opt/sdk", {
      board: BOARD,
      systemManifest: MANIFEST,
    }),
  });
  await settle();

  // Act
  const uri = h.requestSchema("file:///w/board.yaml");

  // Assert
  assert.match(uri, /^alp-schema:\/\/sdk\/board\/[0-9a-f]{64}\.json$/);
  assert.equal(h.requestSchemaContent(uri), BOARD);
});

test("a document that is not ours is never answered for", async () => {
  // Arrange -- any truthy answer REPLACES the static association, so a wrong
  // claim here silently takes over another extension's file.
  const h = harness({ snapshot: snapshotOf("/opt/sdk", { board: BOARD }) });
  await settle();

  // Act / Assert
  assert.equal(h.requestSchema("file:///w/west.yml"), undefined);
  assert.equal(h.requestSchema("file:///w/prj.conf"), undefined);
});

test("an unusable SDK schema falls back rather than serving something wrong", async () => {
  // Arrange -- `nope` is on disk and is not JSON. The customer must land where
  // a customer with no SDK lands, not on an empty schema.
  const h = harness({
    snapshot: snapshotOf("/opt/sdk", {
      board: "nope",
      systemManifest: MANIFEST,
    }),
  });
  await settle();

  // Act / Assert
  assert.equal(h.requestSchema("file:///w/board.yaml"), undefined);
  assert.ok(
    h.requestSchema("file:///w/system-manifest.yaml"),
    "one bad schema must not take the other down with it",
  );
});

test("switching SDK changes the answer without re-registering", async () => {
  // Arrange -- there is NO unregister in vscode-yaml, so the switch has to move
  // the ANSWER. A uri that did not move would leave the client on the previous
  // SDK's cached body: a stale registration in a new shape.
  const h = harness({ snapshot: snapshotOf("/opt/sdk-a", { board: BOARD }) });
  await settle();
  const before = h.requestSchema("file:///w/board.yaml");

  // Act
  h.set(snapshotOf("/opt/sdk-b", { board: '{"properties":{"som":{}}}' }));
  const after = h.requestSchema("file:///w/board.yaml");

  // Assert
  assert.ok(before && after);
  assert.notEqual(before, after);
  assert.equal(h.registrations.length, 1, "registration happens exactly once");
  assert.equal(h.requestSchemaContent(after), '{"properties":{"som":{}}}');
});

test("a previous SDK's body stays addressable after a switch", async () => {
  // Arrange -- the uri is content-addressed, so the same uri always means the
  // same bytes. Keeping it is a cache, not staleness, and the client may still
  // hold it.
  const h = harness({ snapshot: snapshotOf("/opt/sdk-a", { board: BOARD }) });
  await settle();
  const old = h.requestSchema("file:///w/board.yaml");

  // Act
  h.set(snapshotOf("/opt/sdk-b", { board: '{"properties":{}}' }));

  // Assert
  assert.equal(h.requestSchemaContent(old), BOARD);
});

test("retention is capped, and the cap never reaches the CURRENT body", async () => {
  // Arrange -- both halves matter and each fails on its own. Without eviction
  // the map grows for the life of the window; with eviction that could reach
  // the live entry, validation breaks on the SDK actually in use. Oldest-first
  // is only safe because the current offer is re-inserted as the newest, which
  // is exactly what the second assertion pins.
  const h = harness({ snapshot: snapshotOf("/opt/sdk-0", { board: BOARD }) });
  await settle();
  const first = h.requestSchema("file:///w/board.yaml");

  // Act -- comfortably past the cap.
  let uri = null;
  for (let i = 1; i <= 12; i += 1) {
    h.set(snapshotOf(`/opt/sdk-${i}`, { board: `{"title":"v${i}"}` }));
    uri = h.requestSchema("file:///w/board.yaml");
  }

  // Assert
  assert.equal(h.requestSchemaContent(uri), '{"title":"v12"}');
  assert.equal(
    h.requestSchemaContent(first),
    undefined,
    "the oldest body must be evicted, or retention is unbounded",
  );
});

test("after dispose it answers undefined, because there is no unregister", async () => {
  // Arrange -- the callback stays bound to vscode-yaml for the life of the
  // window. Answering after teardown would serve bytes for an SDK nobody is
  // tracking any more.
  const h = harness({ snapshot: snapshotOf("/opt/sdk", { board: BOARD }) });
  await settle();
  assert.ok(h.requestSchema("file:///w/board.yaml"));

  // Act
  h.disposable.dispose();

  // Assert
  assert.equal(h.requestSchema("file:///w/board.yaml"), undefined);
  assert.equal(
    h.listeners.length,
    0,
    "the state subscription must be released",
  );
});

test("a missing YAML extension degrades to the bundled schemas, and says so", async () => {
  // Arrange -- `extensionDependencies` lists it, so absence means a host that
  // ignored that. Losing validation entirely would be far worse than losing
  // the SDK-specific half.
  const h = harness({
    yamlApi: false,
    snapshot: snapshotOf("/opt/sdk", { board: BOARD }),
  });
  await settle();

  // Assert
  assert.equal(h.registrations.length, 0);
  const warned = h.logs.filter((l) => l.level === "warn");
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /redhat\.vscode-yaml is not present/);
});

test("an API without registerContributor is handled, not thrown at", async () => {
  // Arrange -- a future vscode-yaml could change its exported surface.
  const h = harness({
    yamlApi: {},
    snapshot: snapshotOf("/opt/sdk", { board: BOARD }),
  });
  await settle();

  // Assert
  assert.match(
    h.logs.find((l) => l.level === "warn").message,
    /exposes no registerContributor/,
  );
});

test("a scheme already taken is reported, not swallowed", async () => {
  // Arrange -- registerContributor returns false when the key is taken, and
  // there is no unregister, so the previous activation's callbacks keep it.
  const h = harness({
    registerReturns: false,
    snapshot: snapshotOf("/opt/sdk", { board: BOARD }),
  });
  await settle();

  // Assert
  const warned = h.logs.find((l) => l.level === "warn");
  assert.match(warned.message, /already registered/);
  assert.match(warned.message, /Reload the window/);
});

test("a throwing read keeps the previous answer instead of flapping", async () => {
  // Arrange -- "no SDK", "unreadable" and "rejected" all come back as ordinary
  // empty offers. Reaching the catch means our own code failed, and the last
  // good answer beats replacing a correct schema with none.
  const h = harness({ snapshot: snapshotOf("/opt/sdk", { board: BOARD }) });
  await settle();
  const before = h.requestSchema("file:///w/board.yaml");

  // Act -- a snapshot shaped so buildSchemaProvenance throws on it.
  h.set(null);

  // Assert
  assert.equal(h.requestSchema("file:///w/board.yaml"), before);
  assert.match(
    h.logs.find((l) => l.level === "warn").message,
    /SDK schema offer refresh failed/,
  );
});
