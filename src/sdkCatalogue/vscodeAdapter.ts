// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  parseBoardPreset,
  parseChipDef,
  parseSocSpec,
  parseSomPreset,
} from "@alp-sdk/core/sdkCatalogue/parse";
import {
  BoardPreset,
  ChipDef,
  LibraryProfile,
  SdkCatalogue,
  SocSpec,
  SomPreset,
} from "@alp-sdk/core/sdkCatalogue/models";

/** Logger the caller injects (the extension passes `log` from ./util; tests omit it). */
export type LogFn = (message: string) => void;
const noLog: LogFn = () => {};

function emptyCatalogue(): SdkCatalogue {
  return {
    soms: [],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
    sdkVersion: undefined,
  };
}

function readUtf8(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function listFiles(
  dir: string,
  predicate: (name: string) => boolean,
): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(predicate)
    .map((name) => path.join(dir, name));
}

function parseEach<T>(
  files: string[],
  parse: (text: string) => T,
  logError: LogFn,
): T[] {
  const out: T[] = [];
  for (const file of files) {
    try {
      out.push(parse(readUtf8(file)));
    } catch (error) {
      logError(`sdkCatalogue: failed to parse ${file}: ${error}`);
    }
  }
  return out;
}

function findJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonFiles(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

export function loadSdkCatalogue(
  sdkRoot: string | null,
  logError: LogFn = noLog,
): SdkCatalogue {
  if (!sdkRoot) return emptyCatalogue();
  const meta = path.join(sdkRoot, "metadata");
  if (!fs.existsSync(meta)) return emptyCatalogue();

  const soms: SomPreset[] = parseEach(
    listFiles(path.join(meta, "e1m_modules"), (n) => /^E1M-.*\.yaml$/.test(n)),
    parseSomPreset,
    logError,
  ).sort((a, b) => a.sku.localeCompare(b.sku));

  const boards: BoardPreset[] = parseEach(
    listFiles(path.join(meta, "boards"), (n) => n.endsWith(".yaml")),
    parseBoardPreset,
    logError,
  ).sort((a, b) => a.name.localeCompare(b.name));

  const chips: ChipDef[] = parseEach(
    listFiles(path.join(meta, "chips"), (n) => n.endsWith(".yaml")),
    parseChipDef,
    logError,
  ).sort((a, b) => a.chipId.localeCompare(b.chipId));

  const socs: SocSpec[] = parseEach(
    findJsonFiles(path.join(meta, "socs")),
    parseSocSpec,
    logError,
  );

  // board.schema.json's `libraries[]` takes a "Canonical manifest name
  // (metadata/libraries/<name>.yaml)" matching `^[a-z][a-z0-9-]*$` — the
  // manifests ARE the vocabulary. This used to list `metadata/library-profiles/`
  // directories instead, a different concept whose names are underscored:
  // `cmsis_dsp` and `nlohmann_json` fail that pattern outright, so picking
  // either wrote a board.yaml the SDK's own validator rejects, while 29 of the
  // 36 real manifests were never offered at all. `tan presets` reports this
  // same set as `data.boardLibraries`, and the LSP completion for the field
  // already reads it from there (`lsp/sdkCatalog.ts:catalogFromPresets`); this
  // scan is the no-CLI fallback onto identical names.
  const libraries: LibraryProfile[] = listFiles(
    path.join(meta, "libraries"),
    (name) => name.endsWith(".yaml"),
  )
    .map((file) => ({ id: path.basename(file, ".yaml") }))
    .sort((a, b) => a.id.localeCompare(b.id));

  let sdkVersion: string | undefined;
  const versionFile = path.join(meta, "sdk_version.yaml");
  if (fs.existsSync(versionFile)) {
    try {
      const v = (yaml.load(readUtf8(versionFile)) ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof v.version === "string") sdkVersion = v.version;
    } catch (error) {
      logError(`sdkCatalogue: failed to read sdk_version.yaml: ${error}`);
    }
  }

  return { soms, boards, chips, libraries, socs, sdkVersion };
}
