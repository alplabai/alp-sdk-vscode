// SPDX-License-Identifier: Apache-2.0

export interface PadRoute {
  e1m: string;
  dispatch: string;
  dispatchPin?: string;
  doc?: string;
}
export interface I2cDevice {
  bus: string;
  chip: string;
  role?: string;
  address?: string;
}
export interface TopologyCore {
  id: string;
  app?: string;
  image?: string;
  machine?: string;
  board?: string;
  toolchain?: string;
  hwConsole?: boolean;
}

export interface SomPreset {
  sku: string;
  displayName: string;
  family: string;
  silicon: string;
  siliconVariant?: string;
  preferredBackend?: string;
  capabilities: Record<string, boolean>;
  defaultBoard?: string;
  topologyCoreIds: string[];
  topology: TopologyCore[];
  onModule: string[];
  memory?: { dramMbit?: number; flashMbit?: number };
  preliminary: boolean;
  padRoutes: PadRoute[];
  i2cDevices: I2cDevice[];
}

export interface BoardPreset {
  name: string;
  displayName: string;
  hostsSomFamilies: string[];
  populated: Record<string, boolean>;
}

export interface ChipDef {
  chipId: string;
  displayName: string;
  vendor?: string;
  bus?: string;
  driverStatus?: string;
  families: string[];
  kconfig?: { zephyr?: string; baremetal?: string };
}

export interface SocCore {
  id: string;
  type: string;
  count: number;
  freqMhz?: number;
}

export interface SocSpec {
  ref: string;
  vendor: string;
  family: string;
  part: string;
  cores: SocCore[];
}

export interface LibraryProfile {
  id: string;
}

export interface SdkCatalogue {
  soms: SomPreset[];
  boards: BoardPreset[];
  chips: ChipDef[];
  libraries: LibraryProfile[];
  socs: SocSpec[];
  sdkVersion?: string;
}

export interface AcceleratorAvail {
  id: string;
  label: string;
  available: boolean;
}
