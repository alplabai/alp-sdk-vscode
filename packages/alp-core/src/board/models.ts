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

/** A top-level `libraries[]` entry (ADR 0018, board.schema.json `libraries`).
 * A bare name is shorthand for a project-wide `{name}`; the object form scopes
 * the pick to `cores` (omitted = project-wide, every core whose OS the
 * manifest supports). The single place libraries are declared — there is no
 * per-core `cores.<id>.libraries` field. */
export type LibraryEntry = string | { name: string; cores?: string[] };

export interface CoreEntry {
  os?: CoreOs;
  app?: string;
  image?: string;
  peripherals?: string[];
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
  console?: "auto" | "alp" | "uart" | "ram" | "linux" | "none";
  sim_console?: boolean;
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

export interface Boot {
  method?: "mcuboot" | "none";
  signing?: BootSigning;
  swap_algorithm?: "scratch" | "move" | "overwrite";
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
  /** board.yaml schema version (board.schema.json `schemaVersion`, integer >= 1).
   * Lazy: absent means v1 permanently — only a scripts/alp_migrate step writes
   * the key when bumping to v2+. Modeled so the configurator preserves it on
   * round-trip instead of silently dropping it (C1 data-loss gate). */
  schemaVersion?: number;
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
  /** Curated third-party libraries (ADR 0018), board.schema.json `libraries`.
   * The single place libraries are declared — see LibraryEntry. */
  libraries?: LibraryEntry[];
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
  "schemaVersion",
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
  "libraries",
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

/** Names of the top-level libraries effective for `coreId`: a bare string, an
 * object with no `cores` (project-wide), or an object whose `cores` includes
 * `coreId`. Mirrors the `cores:` scoping rule in board.schema.json. */
export function librariesForCore(
  libraries: LibraryEntry[] | undefined,
  coreId: string,
): string[] {
  return (libraries ?? [])
    .filter(
      (entry) =>
        typeof entry === "string" ||
        entry.cores === undefined ||
        entry.cores.includes(coreId),
    )
    .map((entry) => (typeof entry === "string" ? entry : entry.name));
}

/** Apply a per-core library-name selection (the configurator's per-core
 * TagSelector) onto the top-level `libraries[]` array. A newly-added name is
 * merged into an existing entry's `cores` (or a new `{name, cores:[coreId]}`
 * entry); a removed name is dropped from a scoped entry's `cores` (deleting
 * the entry once empty).
 *
 * Removing a *project-wide* entry (bare string / no `cores`) from a single
 * core's picker can't be expressed as "exclude just this core" — the schema
 * has no such primitive — so it is narrowed to the other ids in
 * `allCoreIds` (dropped entirely if that leaves none). This is a lossy
 * approximation for any core NOT included in `allCoreIds` (e.g. a SoM
 * topology core with no board.yaml override): it silently loses the
 * project-wide library for that core too. Callers should pass every core id
 * the project cares about (the full topology, not just `cores:` keys
 * already present in the document). */
export function applyCoreLibrarySelection(
  libraries: LibraryEntry[] | undefined,
  coreId: string,
  nextNames: string[],
  allCoreIds: string[],
): LibraryEntry[] {
  const next = libraries ? [...libraries] : [];
  const currentNames = librariesForCore(next, coreId);
  const nextSet = new Set(nextNames);
  const indexOf = (name: string) =>
    next.findIndex((e) =>
      typeof e === "string" ? e === name : e.name === name,
    );

  for (const name of currentNames) {
    if (nextSet.has(name)) continue;
    const idx = indexOf(name);
    if (idx === -1) continue;
    const entry = next[idx];
    if (typeof entry === "string" || entry.cores === undefined) {
      const others = allCoreIds.filter((id) => id !== coreId);
      if (others.length === 0) next.splice(idx, 1);
      else next[idx] = { name, cores: others };
    } else {
      const cores = entry.cores.filter((id) => id !== coreId);
      if (cores.length === 0) next.splice(idx, 1);
      else next[idx] = { ...entry, cores };
    }
  }

  for (const name of nextNames) {
    if (currentNames.includes(name)) continue;
    const idx = indexOf(name);
    if (idx === -1) {
      next.push({ name, cores: [coreId] });
    } else {
      const entry = next[idx];
      if (
        typeof entry !== "string" &&
        entry.cores !== undefined &&
        !entry.cores.includes(coreId)
      ) {
        next[idx] = { ...entry, cores: [...entry.cores, coreId] };
      }
    }
  }

  return next;
}
