// SPDX-License-Identifier: Apache-2.0
//
// PyYAML's `safe_load` has two implicit scalars the YAML 1.1 mode of the `yaml`
// package does not know: the merge key `<<` and the value indicator `=`. A
// plain `toolchain: <<` or `toolchain: =` makes `safe_load` fail on the WHOLE
// file (`ConstructorError: could not determine a constructor for the tag
// 'tag:yaml.org,2002:merge'` / `...:value`), so the serializer must quote them.
// Every other safe-looking value keeps round-tripping as the same string.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const {
  serializeBoardConfig,
} = require("../packages/alp-core/dist/board/serialize.js");
const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");

const PRIOR = "som:\n  sku: E1M-AEN801\ncores:\n  m55_hp:\n    app: ./src\n";

const SAFE = [
  "yes",
  "off",
  "null",
  "~",
  "0x10",
  "1e3",
  "012",
  "0o7",
  "1_000",
  ".inf",
  "2001-01-01",
  "a: b",
  "#x",
  "- x",
  "x #y",
  "@foo",
];
const TRAPS = ["<<", "="];

const writeToolchain = (value) => {
  const cfg = parseBoardConfig(PRIOR);
  cfg.cores.m55_hp.toolchain = value;
  return serializeBoardConfig(cfg, PRIOR);
};

const PY = `
import sys, json, yaml
docs = json.load(sys.stdin)
print(json.dumps([yaml.safe_load(d)["cores"]["m55_hp"]["toolchain"] for d in docs]))
`;
const pyAvailable =
  spawnSync("python3", ["-c", "import yaml"]).status === 0;

test(
  "PyYAML safe_load reads << and = and every safe value back as the same string",
  { skip: !pyAvailable && "python3 with PyYAML is not installed" },
  () => {
    const values = [...TRAPS, ...SAFE];
    const docs = values.map(writeToolchain);
    const run = spawnSync("python3", ["-c", PY], {
      input: JSON.stringify(docs),
      encoding: "utf-8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), values);
  },
);

test("<< and = are written quoted, so the whole file stays loadable", () => {
  for (const value of TRAPS) {
    assert.match(writeToolchain(value), new RegExp(`toolchain: "${value}"`));
  }
});
