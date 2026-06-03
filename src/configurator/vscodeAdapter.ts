// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { ProjectContext } from "@alp-sdk/core/project/models";
import { log } from "../util";
import {
  BoardModel,
  CarrierPreset,
  PresetCatalogue,
} from "@alp-sdk/core/configurator/models";
import {
  createBoardYaml,
  createDefaultBoardModel,
  createEmptyPresetCatalogue,
  parseBoardModel,
} from "@alp-sdk/core/configurator/service";

export function loadPresetCatalogue(project: ProjectContext): PresetCatalogue {
  const catalogue = createEmptyPresetCatalogue();
  if (!project.sdkRoot) return catalogue;

  catalogue.skus = loadSomSkus(project.sdkRoot);
  catalogue.carriers = loadCarrierPresets(project.sdkRoot);
  return catalogue;
}

export function loadBoardModel(boardPath: string): BoardModel {
  if (!fs.existsSync(boardPath)) {
    return createDefaultBoardModel();
  }

  const text = fs.readFileSync(boardPath, "utf-8");
  return parseBoardModel(text);
}

export function saveBoardModel(boardPath: string, model: BoardModel): void {
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });
  fs.writeFileSync(boardPath, createBoardYaml(model), "utf-8");
}

function loadSomSkus(sdkRoot: string): string[] {
  const modulesDir = path.join(sdkRoot, "metadata", "e1m_modules");
  if (!fs.existsSync(modulesDir)) return [];

  const skus = fs
    .readdirSync(modulesDir)
    .filter((name) => name.startsWith("E1M-"))
    .filter((name) => fs.existsSync(path.join(modulesDir, name, "som.yaml")));

  skus.sort();
  return skus;
}

function loadCarrierPresets(sdkRoot: string): CarrierPreset[] {
  const carriersDir = path.join(sdkRoot, "metadata", "carriers");
  if (!fs.existsSync(carriersDir)) return [];

  const presets: CarrierPreset[] = [];
  for (const name of fs.readdirSync(carriersDir)) {
    const presetPath = path.join(carriersDir, name, "board.yaml");
    if (!fs.existsSync(presetPath)) continue;

    try {
      const parsed = parseBoardModel(fs.readFileSync(presetPath, "utf-8"));
      presets.push({
        name,
        populated: parsed.carrier?.populated ?? {},
      });
    } catch (error) {
      log(`configurator: failed to parse ${presetPath}: ${error}`);
    }
  }

  presets.sort((left, right) => left.name.localeCompare(right.name));
  return presets;
}
