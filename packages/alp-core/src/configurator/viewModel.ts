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
  SomPreset,
  TopologyCore,
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
  /** False for a `cores.<id>` entry the selected SoM's topology lacks (left
   *  behind by a SoM switch): it has no default to describe. */
  inTopology: boolean;
  /** The board.yaml `cores.<id>.toolchain` override (#314); absent = none. */
  toolchain?: string;
  /** The key is present but empty or not a string (hand-edited): the build
   *  would not treat that as "use the default". */
  toolchainInvalid: boolean;
  /** Ids worth offering for THIS core: the SoM default first, then the ids
   *  other SoMs give a core of the same runtime class. Suggestions only. */
  toolchainSuggestions: string[];
  /** The SoM preset's `topology.<id>.toolchain` — what the build uses when
   *  `toolchain` is absent. Same field the Hardware Explorer column reads. */
  defaultToolchain?: string;
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
  /** Whether the project's board schema declares `cores.<id>.toolchain`
   *  (alp-sdk >= v0.17.0); older SDKs reject the key. */
  toolchainSupported: boolean;
  chips: ChipChoice[];
  projectChips: string[];
  validation: ValidationResult;
}

export interface ConfiguratorCapabilities {
  /** Defaults to true (the bundled schema declares the key). */
  toolchainSupported?: boolean;
}

export function buildConfiguratorViewModel(
  board: BoardConfig,
  catalogue: SdkCatalogue,
  capabilities: ConfiguratorCapabilities = {},
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
    const topo = som?.topology?.find((t) => t.id === id);
    const rawToolchain: unknown = core
      ? (core as { toolchain?: unknown }).toolchain
      : undefined;
    const hasToolchainKey =
      core !== undefined && Object.hasOwn(core, "toolchain");
    const toolchain =
      typeof rawToolchain === "string" && rawToolchain.trim() !== ""
        ? rawToolchain
        : undefined;
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
      hwConsole: topo?.hwConsole,
      inTopology: topo !== undefined,
      toolchain,
      toolchainInvalid: hasToolchainKey && toolchain === undefined,
      toolchainSuggestions: suggestToolchains(catalogue, som, topo, core?.os),
      defaultToolchain: topo?.toolchain,
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
    toolchainSupported: capabilities.toolchainSupported ?? true,
    chips,
    projectChips: board.chips ?? [],
    validation: validateBoardConfig(board),
  };
}

type RuntimeClass = "zephyr" | "linux";

/** Cortex-A cores carry a Yocto `machine`/`image`; Cortex-M cores a Zephyr
 *  `board`. The topology is the only per-core class the catalogue has. */
function topologyClass(t: TopologyCore): RuntimeClass | undefined {
  if (t.machine || t.image) return "linux";
  if (t.board) return "zephyr";
  return undefined;
}

function osClass(os: string | undefined): RuntimeClass | undefined {
  if (os === "zephyr") return "zephyr";
  if (os === "yocto") return "linux";
  return undefined;
}

/** Toolchain ids for one core: its SoM default first, then every other id the
 *  catalogue gives a core of the same runtime class (a Zephyr core must not be
 *  offered `poky-glibc`). No table of our own — the SDK catalogue is the only
 *  vocabulary (#314). A core with no known class gets only its own default. */
function suggestToolchains(
  catalogue: SdkCatalogue,
  selected: SomPreset | undefined,
  topo: TopologyCore | undefined,
  os: string | undefined,
): string[] {
  const cls = (topo ? topologyClass(topo) : undefined) ?? osClass(os);
  const own = topo?.toolchain ? [topo.toolchain] : [];
  if (!cls) return own;
  const others = new Set<string>();
  const sameClass = (soms: SomPreset[]) => {
    for (const s of soms)
      for (const t of s.topology ?? [])
        if (t.toolchain && topologyClass(t) === cls) others.add(t.toolchain);
  };
  sameClass(selected ? [selected] : []);
  const ownSom = [...others].sort();
  others.clear();
  sameClass(catalogue.soms);
  const rest = [...others].sort();
  return [...new Set([...own, ...ownSom, ...rest])];
}
