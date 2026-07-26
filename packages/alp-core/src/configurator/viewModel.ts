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
  hwConsole?: boolean;
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
    return {
      id,
      inheritedFromTopology: core === undefined,
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
      hwConsole: som?.topology?.find((t) => t.id === id)?.hwConsole,
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
  };
}
