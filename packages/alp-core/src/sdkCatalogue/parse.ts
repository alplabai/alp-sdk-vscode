// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardPreset, SomPreset } from "./models";

function isTbd(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "TBD";
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && !isTbd(v)) return v;
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function boolMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = Boolean(val);
    }
  }
  return out;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parseBoardPreset(text: string): BoardPreset {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  return {
    name: str(d.name) ?? "",
    displayName: str(d.display_name) ?? str(d.name) ?? "",
    hostsSomFamilies: strList(d.hosts_som_families),
    populated: boolMap(d.populated),
  };
}

export function parseSomPreset(text: string): SomPreset {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  const inference = (d.inference ?? {}) as Record<string, unknown>;
  const topology = (d.topology ?? {}) as Record<string, unknown>;
  const onModuleRaw = (d.on_module ?? {}) as Record<string, unknown>;
  const memory = (d.memory ?? {}) as Record<string, unknown>;
  const status = (d.status ?? {}) as Record<string, unknown>;

  const dramMbit = num(memory.dram_mbit);
  const flashMbit = num(memory.flash_mbit);
  const hasMemory = dramMbit !== undefined || flashMbit !== undefined;

  return {
    sku: str(d.sku) ?? "",
    displayName: str(d.display_name) ?? str(d.sku) ?? "",
    family: str(d.family) ?? "",
    silicon: str(d.silicon) ?? "",
    siliconVariant: str(d.silicon_variant),
    preferredBackend: str(inference.preferred_backend),
    capabilities: boolMap(d.capabilities),
    defaultBoard: str(d.default_board),
    topologyCoreIds: Object.keys(topology),
    onModule: Object.entries(onModuleRaw)
      .filter(([, val]) => typeof val === "string" && !isTbd(val))
      .map(([, val]) => val as string),
    memory: hasMemory ? { dramMbit, flashMbit } : undefined,
    preliminary: Boolean(status.preliminary),
  };
}
