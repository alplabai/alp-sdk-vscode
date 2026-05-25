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
  return { soms: [], boards: [], chips: [], libraries: [], socs: [], sdkVersion: undefined };
}

function readUtf8(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function listFiles(dir: string, predicate: (name: string) => boolean): string[] {
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

  const libDir = path.join(meta, "library-profiles");
  const libraries: LibraryProfile[] = fs.existsSync(libDir)
    ? fs
        .readdirSync(libDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  let sdkVersion: string | undefined;
  const versionFile = path.join(meta, "sdk_version.yaml");
  if (fs.existsSync(versionFile)) {
    try {
      const v = (yaml.load(readUtf8(versionFile)) ?? {}) as Record<string, unknown>;
      if (typeof v.version === "string") sdkVersion = v.version;
    } catch (error) {
      logError(`sdkCatalogue: failed to read sdk_version.yaml: ${error}`);
    }
  }

  return { soms, boards, chips, libraries, socs, sdkVersion };
}
