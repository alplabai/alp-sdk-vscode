// SPDX-License-Identifier: Apache-2.0
//
// The board.yaml completion catalog — the concrete value lists (SoM SKUs, ADR-0018
// libraries) the LSP completes against. It is sourced from `alp presets` (the
// single CLI surface for the active SDK's metadata) and pushed to the LSP server
// by the client (see client.ts); there is no direct metadata scan here, so the
// CLI is the one source shared with the New Project flow, the Configurator, and
// Alp Studio.

import type { KconfigSymbol, KconfigType } from "./kconfig";

/** Concrete value lists derived from the active SDK via `alp presets`. */
export interface SdkCompletionCatalog {
  /** SoM SKUs (`alp presets` `soms[].sku`). */
  skus: readonly string[];
  /** ADR-0018 board libraries (`alp presets` `boardLibraries`). */
  libraries: readonly string[];
  /**
   * Live per-core Kconfig symbols from `tan kconfig --core <id>` (alp-sdk
   * #894), keyed `${boardYamlPath}::${coreId}` — the same key server.ts
   * derives via `buildConfig.ts:resolveSlice` for a given prj.conf. A core
   * with no entry (not yet fetched, or the fetch failed / the CLI predates
   * `--core`) falls back to the vendored/curated set — see kconfig.ts.
   */
  kconfigByCore: Readonly<Record<string, readonly KconfigSymbol[]>>;
}

/** The degraded catalog used before the first push / when no SDK (or CLI) is
 *  available — completion then falls back to the built-in defaults. */
export const EMPTY_SDK_CATALOG: SdkCompletionCatalog = {
  skus: [],
  libraries: [],
  kconfigByCore: {},
};

/** The subset of the `alp presets` envelope `data` payload the catalog needs. */
interface PresetsData {
  soms?: { sku?: string }[];
  boardLibraries?: string[];
}

/** Build the completion catalog from an `alp presets` `data` payload. Pure +
 *  tolerant: a missing/degenerate payload (or an old CLI without
 *  `boardLibraries`) collapses to empty lists rather than throwing. */
export function catalogFromPresets(data: unknown): SdkCompletionCatalog {
  const payload = (data ?? {}) as PresetsData;
  const skus = (payload.soms ?? [])
    .map((som) => som?.sku)
    .filter((sku): sku is string => typeof sku === "string" && sku.length > 0);
  const libraries = (payload.boardLibraries ?? []).filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
  return { skus, libraries, kconfigByCore: {} };
}

const KCONFIG_TYPES: ReadonlySet<string> = new Set([
  "bool",
  "int",
  "hex",
  "string",
]);

/** One symbol from the SDK's rich `tan kconfig --core <id>` envelope
 *  (alp-sdk #894) — a promptable Kconfig symbol, bare name (no `CONFIG_`
 *  prefix), typed as `unknown` field-by-field since it crosses a process
 *  boundary as untrusted JSON. */
interface SdkKconfigSymbol {
  name?: unknown;
  type?: unknown;
  prompt?: unknown;
  default?: unknown;
  help?: unknown;
}

/** The subset of the `tan kconfig --core <id>` envelope `data` payload the
 *  catalog needs. */
interface KconfigData {
  symbols?: unknown;
}

/**
 * Extract live Kconfig symbols from a `tan kconfig --core <id>` `data`
 * payload, mapped onto the LSP's `KconfigSymbol` shape (`type`→`type`,
 * `doc` = `help || prompt || ""`, `valueHint` = `default` (dropped when
 * empty), `source` = `"sdk-live"`).
 *
 * Pure + tolerant: a missing/degenerate payload, a non-array `symbols`, or a
 * malformed entry (missing/empty name, a junk `type`) is dropped rather than
 * thrown — this is also the fallback shape when the CLI predates rich
 * `--core` kconfig entirely, or still emits the old flat `{symbols:
 * string[]}` payload (#298): neither has object entries, so both collapse to
 * an empty list here exactly like no payload at all, and every caller falls
 * back to the vendored/curated set.
 */
export function kconfigSymbolsFromEnvelope(data: unknown): KconfigSymbol[] {
  const payload = (data ?? {}) as KconfigData;
  const symbols = payload.symbols;
  if (!Array.isArray(symbols)) return [];

  const out: KconfigSymbol[] = [];
  for (const entry of symbols) {
    if (typeof entry !== "object" || entry === null) continue;
    const sym = entry as SdkKconfigSymbol;
    if (typeof sym.name !== "string" || sym.name.length === 0) continue;

    const type =
      typeof sym.type === "string" && KCONFIG_TYPES.has(sym.type)
        ? (sym.type as KconfigType)
        : undefined;
    const help = typeof sym.help === "string" ? sym.help : "";
    const prompt = typeof sym.prompt === "string" ? sym.prompt : "";
    const rawDefault = sym.default;
    const valueHint =
      typeof rawDefault === "string"
        ? rawDefault || undefined
        : typeof rawDefault === "number" || typeof rawDefault === "boolean"
          ? String(rawDefault)
          : undefined;

    const symbol: KconfigSymbol = {
      name: sym.name,
      doc: help || prompt || "",
      source: "sdk-live",
    };
    if (type) symbol.type = type;
    if (valueHint !== undefined) symbol.valueHint = valueHint;
    out.push(symbol);
  }
  return out;
}

/** Per-`${sdkRoot}::${boardYamlPath}::${coreId}` cache of the live symbols
 *  fetched for that core — mirrors src/pinmux/loader.ts's table cache, except
 *  there is no mtime to invalidate on here, so only a NON-EMPTY result is
 *  cached: an empty/failed fetch (old CLI, transient error) must not stick,
 *  so the next push retries it instead of silently starving completion for
 *  the rest of the window. */
const kconfigCache = new Map<string, readonly KconfigSymbol[]>();

/**
 * Fetch (and cache) the live Kconfig symbols for one core. `fetchEnvelope` is
 * the injectable seam — the real caller (client.ts) shells `tan kconfig
 * --core <id>` via `runAlpCommand`; tests inject a fake — so this stays pure
 * and unit-testable without `vscode`.
 */
export async function fetchKconfigSymbolsForCore(
  sdkRoot: string,
  boardYamlPath: string,
  coreId: string,
  cwd: string,
  fetchEnvelope: (coreId: string, cwd: string) => Promise<unknown>,
): Promise<readonly KconfigSymbol[]> {
  const key = `${sdkRoot}::${boardYamlPath}::${coreId}`;
  const cached = kconfigCache.get(key);
  if (cached !== undefined) return cached;

  const symbols = kconfigSymbolsFromEnvelope(await fetchEnvelope(coreId, cwd));
  if (symbols.length > 0) kconfigCache.set(key, symbols);
  return symbols;
}

export function clearKconfigSymbolCache(): void {
  kconfigCache.clear();
}
