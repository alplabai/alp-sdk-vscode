// SPDX-License-Identifier: Apache-2.0

import { BoardConfig, librariesForCore } from "../board/models";
import { validateBoardConfig, ValidationResult } from "../board/validate";
import {
  acceleratorAvailability,
  boardsForSom,
  chipDefaults,
  chipsForSom,
} from "../sdkCatalogue/derive";
import {
  AcceleratorAvail,
  BoardPreset,
  SdkCatalogue,
} from "../sdkCatalogue/models";

export interface SomOptionGroup {
  family: string;
  soms: { sku: string; displayName: string; preliminary: boolean }[];
}

export interface HardwareCard {
  sku: string;
  displayName: string;
  silicon: string;
  cores: { id: string; type: string; count: number; freqMhz?: number }[];
  preferredBackend?: string;
  defaultBoard?: string;
  onModule: string[];
  preliminary: boolean;
}

export interface CorePanel {
  id: string;
  inheritedFromTopology: boolean;
  os?: string;
  app?: string;
  image?: string;
  peripherals: string[];
  libraries: string[];
  iot: { wifi: boolean; mqtt: boolean; ble: boolean; tls: boolean };
  inferenceArenaKib?: number;
  /** Mirrors `TopologyCore.hwConsole` from the SoM preset: `false` means this
   *  core is headless (no hardware UART console). Absent means it has one —
   *  only an explicit `false` is a headless marker. */
  hwConsole?: boolean;
}

/** True when the SoM topology marks this core headless. Centralised so the
 *  absent-means-true rule lives in ONE place: writing `!core.hwConsole` at a
 *  call site silently treats every core whose SoM YAML omits `hw_console` as
 *  serial-less, which is every AEN and NX9 core today. */
export function isHeadlessCore(core: { hwConsole?: boolean }): boolean {
  return core.hwConsole === false;
}

/** Guidance shown next to the `diagnostics.console` selector. */
export interface ConsoleAdvice {
  severity: "warning" | "info";
  message: string;
}

/**
 * Advice on `diagnostics.console` given which cores are headless.
 *
 * `diagnostics.console` is project-wide (it "applies to every slice"), so one
 * headless core is enough to make a serial backend the wrong choice for the
 * project — which is why the message names the cores rather than just saying
 * "a core".
 *
 * Only `uart`/`alp` (an explicit serial console) and `auto` (which resolves to
 * the module UART console on a Zephyr slice) can strand a headless core.
 * `ram` is already the right answer; `linux` belongs to a Yocto slice whose
 * A55 owns the debug UART; `none` is a deliberate "inherit the board default"
 * and not ours to second-guess.
 */
export function headlessConsoleAdvice(
  headlessCoreIds: readonly string[],
  consoleBackend: string | undefined,
): ConsoleAdvice | null {
  if (headlessCoreIds.length === 0) return null;
  const cores = headlessCoreIds.join(", ");
  const plural = headlessCoreIds.length > 1;
  const subject = `${plural ? "Cores" : "Core"} ${cores} ${plural ? "have" : "has"} no hardware UART console`;

  switch (consoleBackend ?? "auto") {
    case "uart":
    case "alp":
      return {
        severity: "warning",
        message:
          `${subject}, so a serial console backend produces no readable output there. ` +
          "Use `ram` to read ram_console_buf over SWD/J-Link, or enable the simulator " +
          "console below if this bundle is destined for the hardware simulator.",
      };
    case "auto":
      return {
        severity: "info",
        message:
          `${subject}. \`auto\` resolves to the module UART console on a Zephyr slice, ` +
          "so consider `ram` — printf/LOG lands in ram_console_buf, readable over SWD/J-Link.",
      };
    default:
      return null;
  }
}

export interface ChipChoice {
  chipId: string;
  displayName: string;
  vendor?: string;
  bus?: string;
  driverStatus?: string;
  enabled: boolean;
}

export interface ConfiguratorViewModel {
  sdkConnected: boolean;
  som: { selected: string; options: SomOptionGroup[] };
  hardware: HardwareCard | null;
  accelerators: AcceleratorAvail[];
  boardMode: "preset" | "inline";
  carriers: { selected?: string; options: BoardPreset[] };
  cores: CorePanel[];
  libraries: string[];
  chips: ChipChoice[];
  projectChips: string[];
  validation: ValidationResult;
  /** Guidance for the `diagnostics.console` selector when the SoM topology
   *  marks any core headless; null when there is nothing to say. Computed
   *  HERE, not in the webview: the webview is a separate bundle that mirrors
   *  types by hand and shares no source, so shipping the finished advice over
   *  the protocol is what keeps the rule from existing in two places. */
  consoleAdvice: ConsoleAdvice | null;
}

export function buildConfiguratorViewModel(
  board: BoardConfig,
  catalogue: SdkCatalogue,
): ConfiguratorViewModel {
  const selected = board.som?.sku ?? "";
  const som = catalogue.soms.find((s) => s.sku === selected);

  const groups = new Map<string, SomOptionGroup>();
  for (const s of catalogue.soms) {
    let group = groups.get(s.family);
    if (!group) {
      group = { family: s.family, soms: [] };
      groups.set(s.family, group);
    }
    group.soms.push({
      sku: s.sku,
      displayName: s.displayName,
      preliminary: s.preliminary,
    });
  }

  let hardware: HardwareCard | null = null;
  if (som) {
    const soc = catalogue.socs.find((sp) => sp.ref === som.silicon);
    hardware = {
      sku: som.sku,
      displayName: som.displayName,
      silicon: som.silicon,
      cores: soc
        ? soc.cores.map((c) => ({
            id: c.id,
            type: c.type,
            count: c.count,
            freqMhz: c.freqMhz,
          }))
        : [],
      preferredBackend: som.preferredBackend,
      defaultBoard: som.defaultBoard,
      onModule: som.onModule,
      preliminary: som.preliminary,
    };
  }

  const topoIds = som?.topologyCoreIds ?? [];
  const boardCoreIds = Object.keys(board.cores ?? {});
  const orderedIds = [
    ...topoIds,
    ...boardCoreIds.filter((id) => !topoIds.includes(id)),
  ];
  const cores: CorePanel[] = orderedIds.map((id) => {
    const core = board.cores?.[id];
    const iot = core?.iot ?? {};
    // hw_console is a SoM-topology fact, so it comes from the preset even for
    // a core board.yaml never mentions (inheritedFromTopology).
    // `?.topology?.` not `?.topology.` — a SomPreset built by hand (tests, and
    // any catalogue produced before parse.ts grew the field) has no topology
    // array at all, and an unguarded .find() throws before the panel renders.
    const topo = som?.topology?.find((t) => t.id === id);
    return {
      id,
      inheritedFromTopology: core === undefined,
      hwConsole: topo?.hwConsole,
      os: core?.os,
      app: core?.app,
      image: core?.image,
      peripherals: core?.peripherals ?? [],
      libraries: librariesForCore(board.libraries, id),
      iot: {
        wifi: Boolean(iot.wifi),
        mqtt: Boolean(iot.mqtt),
        ble: Boolean(iot.ble),
        tls: Boolean(iot.tls),
      },
      inferenceArenaKib: core?.inference?.default_arena_kib,
    };
  });

  const selectedPreset = catalogue.boards.find((b) => b.name === board.preset);
  const effectivePopulated = {
    ...(selectedPreset ? chipDefaults(selectedPreset) : {}),
    ...(board.populated ?? {}),
  };
  const chips: ChipChoice[] = chipsForSom(catalogue, selected).map((chip) => ({
    chipId: chip.chipId,
    displayName: chip.displayName,
    vendor: chip.vendor,
    bus: chip.bus,
    driverStatus: chip.driverStatus,
    enabled: effectivePopulated[chip.chipId] === true,
  }));

  return {
    sdkConnected: catalogue.soms.length > 0,
    som: { selected, options: [...groups.values()] },
    hardware,
    accelerators: som ? acceleratorAvailability(som) : [],
    boardMode:
      board.populated !== undefined || board.e1m_routes !== undefined
        ? "inline"
        : "preset",
    carriers: {
      selected: board.preset,
      options: boardsForSom(catalogue, selected),
    },
    cores,
    libraries: catalogue.libraries.map((l) => l.id),
    chips,
    projectChips: board.chips ?? [],
    validation: validateBoardConfig(board),
    consoleAdvice: headlessConsoleAdvice(
      cores.filter(isHeadlessCore).map((c) => c.id),
      board.diagnostics?.console,
    ),
  };
}
