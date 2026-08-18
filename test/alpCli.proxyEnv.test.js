// SPDX-License-Identifier: Apache-2.0
//
// The proxy variables the extension adds to a spawned `tan`'s environment.
//
// Why this file exists: `tan` takes no `--proxy` flag — it reads the
// environment (tan-cli `crates/tan-cli/src/http.rs`), so a corporate user who
// set `http.proxy` in VS Code got a `tan` that ignored it and `tan sdk list`
// died on a raw transport error. The mechanism is entirely "which variables do
// we put in the child's env", so that decision is a pure function and every
// case below drives it with an explicit `env` object rather than the machine's.
//
// The load-bearing assertion is the PRECEDENCE one: an already-exported
// variable is left alone. Getting that backwards silently breaks a machine
// whose shell proxy config was correct.

const test = require("node:test");
const assert = require("node:assert/strict");

const { proxyEnvOverrides } = require("../out/alpCli/service.js");

test("the setting fills a gap: no proxy var in the env, so both are added", () => {
  assert.deepEqual(proxyEnvOverrides("http://proxy.corp:8080", {}), {
    HTTPS_PROXY: "http://proxy.corp:8080",
    HTTP_PROXY: "http://proxy.corp:8080",
  });
});

test("an exported HTTPS_PROXY WINS over the IDE setting", () => {
  const overrides = proxyEnvOverrides("http://from-settings:8080", {
    HTTPS_PROXY: "http://from-shell:3128",
  });
  assert.equal(
    overrides.HTTPS_PROXY,
    undefined,
    "the shell's HTTPS_PROXY must be left exactly as the user exported it",
  );
  // The http side had no variable of its own, so the setting still fills THAT
  // gap — `HTTP_PROXY` is http-only to git/curl/pip, so leaving it empty
  // because a DIFFERENT variable was set would help nobody.
  assert.equal(overrides.HTTP_PROXY, "http://from-settings:8080");
});

test("the four names tan reads for https all block the https gap-fill", () => {
  // tan's precedence is ALL_PROXY > all_proxy > HTTPS_PROXY > https_proxy
  // (tan-core `select_https_proxy`). Checking only the uppercase spelling would
  // let our HTTPS_PROXY OUTRANK a user's lowercase `https_proxy` inside tan —
  // the override this rule exists to prevent, arriving through the back door.
  for (const name of ["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy"]) {
    const overrides = proxyEnvOverrides("http://from-settings:8080", {
      [name]: "http://from-shell:3128",
    });
    assert.equal(
      overrides.HTTPS_PROXY,
      undefined,
      `${name} in the environment must block the HTTPS_PROXY gap-fill`,
    );
  }
});

test("ALL_PROXY blocks both, since it covers both schemes", () => {
  assert.deepEqual(
    proxyEnvOverrides("http://from-settings:8080", {
      ALL_PROXY: "socks5://from-shell:1080",
    }),
    {},
  );
});

test("an EMPTY exported value counts as set — it means 'go direct'", () => {
  // `export HTTPS_PROXY=` is the conventional way to disable an inherited
  // proxy, and tan reads an empty value as unset. Filling it from the setting
  // would override exactly the wish it expresses.
  assert.deepEqual(
    proxyEnvOverrides("http://from-settings:8080", {
      HTTPS_PROXY: "",
      HTTP_PROXY: "",
    }),
    {},
  );
});

test("no setting: nothing is added, whatever the environment holds", () => {
  const env = {
    PATH: "/usr/bin",
    NO_PROXY: "github.com",
    HTTPS_PROXY: "http://from-shell:3128",
  };
  for (const setting of ["", "   "]) {
    assert.deepEqual(
      proxyEnvOverrides(setting, env),
      {},
      `a ${JSON.stringify(setting)} http.proxy must add nothing`,
    );
  }
});

test("the rest of the environment passes through unchanged, NO_PROXY included", () => {
  // VS Code has no bypass-list setting, so the environment is NO_PROXY's only
  // source. Overwriting or dropping it would take a machine that correctly goes
  // direct to an internal mirror and push it through the proxy instead.
  const env = {
    PATH: "/usr/bin",
    NO_PROXY: "github.com,.corp.internal",
    no_proxy: "github.com",
    ZEPHYR_BASE: "/opt/zephyr",
  };
  const overrides = proxyEnvOverrides("http://proxy.corp:8080", env);
  assert.deepEqual(overrides, {
    HTTPS_PROXY: "http://proxy.corp:8080",
    HTTP_PROXY: "http://proxy.corp:8080",
  });
  // This is what the adapter's `spawnEnv()` hands `cp.spawn`.
  assert.deepEqual(
    { ...env, ...overrides },
    {
      PATH: "/usr/bin",
      NO_PROXY: "github.com,.corp.internal",
      no_proxy: "github.com",
      ZEPHYR_BASE: "/opt/zephyr",
      HTTPS_PROXY: "http://proxy.corp:8080",
      HTTP_PROXY: "http://proxy.corp:8080",
    },
  );
  // And the input is not mutated — `spawnEnv()` spreads `process.env`, so a
  // mutating implementation would edit the extension host's own environment.
  assert.equal(env.HTTPS_PROXY, undefined);
});

test("the setting is trimmed before it is written", () => {
  assert.deepEqual(proxyEnvOverrides("  http://proxy.corp:8080  ", {}), {
    HTTPS_PROXY: "http://proxy.corp:8080",
    HTTP_PROXY: "http://proxy.corp:8080",
  });
});
