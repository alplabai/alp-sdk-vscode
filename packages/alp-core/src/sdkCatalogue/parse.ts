// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import {
  BoardPreset,
  ChipDef,
  I2cDevice,
  PadRoute,
  SocCore,
  SocSpec,
  SomPreset,
  TopologyCore,
} from "./models";

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

/** Strict boolean read: anything that is not a real YAML boolean stays
 *  `undefined` rather than collapsing to false. Callers distinguish "absent"
 *  (inherit the default) from an explicit `false`, so `Boolean(v)` would be
 *  wrong here — it turns every missing key into a hard false. */
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
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
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
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

export function parseChipDef(text: string): ChipDef {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  const kc = (d.kconfig ?? {}) as Record<string, unknown>;
  const zephyr = str(kc.zephyr);
  const baremetal = str(kc.baremetal);
  const hasKconfig = zephyr !== undefined || baremetal !== undefined;
  return {
    chipId: str(d.chip_id) ?? "",
    displayName: str(d.display_name) ?? str(d.chip_id) ?? "",
    vendor: str(d.vendor),
    bus: str(d.bus),
    driverStatus: str(d.driver_status),
    families: strList(d.families),
    kconfig: hasKconfig ? { zephyr, baremetal } : undefined,
  };
}

export function parseSocSpec(text: string): SocSpec {
  const d = JSON.parse(text) as Record<string, any>;
  const cores: SocCore[] = Array.isArray(d.cores)
    ? d.cores.map((c: Record<string, unknown>) => ({
        id: String(c.id ?? ""),
        type: String(c.type ?? ""),
        count: typeof c.count === "number" ? c.count : 1,
        freqMhz: num(c.freq_mhz),
      }))
    : [];
  return {
    ref: String(d.ref ?? ""),
    vendor: String(d.vendor ?? ""),
    family: String(d.family ?? ""),
    part: String(d.part ?? ""),
    cores,
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

  const padRoutesRaw = Array.isArray(d.pad_routes) ? d.pad_routes : [];
  const padRoutes: PadRoute[] = padRoutesRaw
    .filter((r: any) => r && typeof r.e1m === "string")
    .map((r: any) => ({
      e1m: String(r.e1m),
      dispatch: String(r.dispatch ?? ""),
      dispatchPin: r.dispatch_pin != null ? String(r.dispatch_pin) : undefined,
      doc: str(r.doc),
    }));

  const i2cRaw = (onModuleRaw.i2c_devices ?? {}) as Record<string, any>;
  const i2cDevices: I2cDevice[] = [];
  for (const [bus, def] of Object.entries(i2cRaw)) {
    const devs = def && Array.isArray(def.devices) ? def.devices : [];
    for (const dv of devs) {
      if (dv && typeof dv.chip === "string") {
        i2cDevices.push({
          bus,
          chip: dv.chip,
          role: str(dv.role),
          address: str(dv.address_7bit),
        });
      }
    }
  }

  const topologyDetail: TopologyCore[] = Object.entries(topology).map(
    ([id, t]) => {
      const tc = (t ?? {}) as Record<string, unknown>;
      return {
        id,
        app: str(tc.app),
        image: str(tc.image),
        machine: str(tc.machine),
        board: str(tc.board),
        toolchain: str(tc.toolchain),
        hwConsole: bool(tc.hw_console),
      };
    },
  );

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
    topology: topologyDetail,
    onModule: Object.entries(onModuleRaw)
      // `silicon:` is the SoC reference (captured separately), not a companion chip.
      .filter(
        ([key, val]) =>
          key !== "silicon" && typeof val === "string" && !isTbd(val),
      )
      .map(([, val]) => val as string),
    memory: hasMemory ? { dramMbit, flashMbit } : undefined,
    preliminary: Boolean(status.preliminary),
    padRoutes,
    i2cDevices,
  };
}
