// SPDX-License-Identifier: Apache-2.0

export type CoreOs = "zephyr" | "yocto" | "baremetal" | "off";
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogLevelOrOff = LogLevel | "off";

export interface BoardSom {
  sku: string;
  hw_rev?: string;
}

export interface CoreMemory {
  stack_kib?: number;
  heap_kib?: number;
  isr_stack_kib?: number;
}

export interface CorePower {
  sleep_mode?: "disabled" | "idle" | "standby" | "deep";
  wakeup_sources?: string[];
}

export interface CoreInference {
  default_arena_kib?: number;
}

export interface CoreIot {
  wifi?: boolean;
  mqtt?: boolean;
  ble?: boolean;
  tls?: boolean;
}

export interface ExtraLibrary {
  name: string;
  include_path?: string;
  kconfig?: string[];
  profile?: string;
}

export interface CoreEntry {
  os?: CoreOs;
  app?: string;
  image?: string;
  peripherals?: string[];
  libraries?: string[];
  extra_libraries?: ExtraLibrary[];
  memory?: CoreMemory;
  power?: CorePower;
  inference?: CoreInference;
  iot?: CoreIot;
}

export interface Diagnostics {
  last_error?: boolean;
  log_level?: LogLevel;
  modules?: Record<string, LogLevelOrOff>;
}

export interface StoragePartition {
  name: string;
  size_kib: number;
  fs?: "littlefs" | "fat" | "ext4" | "raw";
  mount?: string;
  flash_device?: string;
  offset_kib?: number;
  raw?: boolean;
}

export interface SecurityPsa {
  persistent_slots?: number;
  its_storage?: string;
  ps_storage?: string;
  tfm?: boolean;
  attestation_root?: "optiga_trust_m" | "tfm_internal" | "none";
}

export interface Security {
  psa?: SecurityPsa;
}

export interface BootSigning {
  algorithm: "ecdsa_p256" | "rsa2048" | "rsa3072" | "ed25519";
  key_file: string;
}

export interface BootSlot {
  size_kib: number;
}

export interface Boot {
  method?: "mcuboot" | "none";
  signing?: BootSigning;
  slots?: { primary: BootSlot; secondary: BootSlot };
  swap_algorithm?: "scratch" | "move" | "overwrite";
  scratch_size_kib?: number;
  anti_rollback?: boolean;
  build_type?: "Release" | "Debug" | "MinSizeRel";
}

export interface OtaServer {
  url: string;
  tenant?: string;
  tls_ca_bundle?: string;
}

export interface OtaRollback {
  enabled?: boolean;
  retries?: number;
  min_version?: number;
}

export interface OtaStorage {
  device?: string;
  boot_part_mb?: number;
  rootfs_ab?: boolean;
  total_size_mb?: number;
}

export interface Ota {
  provider: "mender" | "hawkbit" | "mcumgr" | "none";
  artifact_name?: string;
  signing_key?: string;
  server?: OtaServer;
  rollback?: OtaRollback;
  poll_interval_s?: number;
  storage?: OtaStorage;
}

export interface IpcEntry {
  kind: "rpmsg" | "raw_shmem" | "mailbox_only";
  endpoints: string[];
  carve_out_kb: number;
  name: string;
  cacheable?: boolean;
  address?: number;
}

export interface RouteEntry {
  e1m: string;
  macro: string;
  doc?: string;
  active_low?: boolean;
  pull?: "up" | "down" | "none";
  debounce_ms?: number;
  board_alias?: string;
}

export interface E1mRoutes {
  gpio?: RouteEntry[];
  buses?: RouteEntry[];
  pwm?: RouteEntry[];
  adc?: RouteEntry[];
  dac?: RouteEntry[];
  i2s?: RouteEntry[];
  can?: RouteEntry[];
  qenc?: RouteEntry[];
}

export type PinRef = string | { e1m: string; macro?: string; doc?: string };

/** An AI model to compile + package into .alpmodel (board.schema.json `models`). */
export interface ModelEntry {
  name: string;
  source: string;
  spec?: string;
  inputs?: unknown[];
  /** Per-backend NPU compile configuration (paths to config/calibration/spec). */
  compile?: {
    deepx_dxm1?: { config: string; calibration: string };
    drpai?: { spec: string };
  };
}

export interface BoardConfig {
  name?: string;
  description?: string;
  preset?: string;
  hw_rev?: string;
  som: BoardSom;
  cores: Record<string, CoreEntry>;
  populated?: Record<string, boolean>;
  e1m_routes?: E1mRoutes;
  pins?: PinRef[];
  chips?: string[];
  ipc?: IpcEntry[];
  diagnostics?: Diagnostics;
  storage?: StoragePartition[];
  security?: Security;
  boot?: Boot;
  ota?: Ota;
  features?: Record<string, unknown>;
  models?: ModelEntry[];
  supported_boards?: string[];
}

/** Top-level key order used by serializeBoardConfig (mirrors board.schema.json). */
export const BOARD_KEY_ORDER: (keyof BoardConfig)[] = [
  "name",
  "description",
  "preset",
  "hw_rev",
  "som",
  "cores",
  "populated",
  "e1m_routes",
  "pins",
  "chips",
  "ipc",
  "diagnostics",
  "storage",
  "security",
  "boot",
  "ota",
  "features",
  "models",
  "supported_boards",
];
