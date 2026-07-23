// SPDX-License-Identifier: Apache-2.0
//
// The board.yaml completion catalog — the concrete value lists (SoM SKUs, ADR-0018
// libraries) the LSP completes against. It is sourced from `alp presets` (the
// single CLI surface for the active SDK's metadata) and pushed to the LSP server
// by the client (see client.ts); there is no direct metadata scan here, so the
// CLI is the one source shared with the New Project flow, the Configurator, and
// Alp Studio.

/** Concrete value lists derived from the active SDK via `alp presets`. */
export interface SdkCompletionCatalog {
  /** SoM SKUs (`alp presets` `soms[].sku`). */
  skus: readonly string[];
  /** ADR-0018 board libraries (`alp presets` `boardLibraries`). */
  libraries: readonly string[];
  /** Live Kconfig symbol names (no `CONFIG_` prefix) from `tan kconfig`.
   *  Empty when the CLI predates that command — see kconfigSymbolsFromEnvelope. */
  kconfigSymbols: readonly string[];
}

/** The degraded catalog used before the first push / when no SDK (or CLI) is
 *  available — completion then falls back to the built-in defaults. */
export const EMPTY_SDK_CATALOG: SdkCompletionCatalog = {
  skus: [],
  libraries: [],
  kconfigSymbols: [],
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
  return { skus, libraries, kconfigSymbols: [] };
}

/** The subset of the `tan kconfig` envelope `data` payload the catalog needs. */
interface KconfigData {
  symbols?: unknown;
}

/** Extract live Kconfig symbol names from a `tan kconfig` `data` payload. Pure +
 *  tolerant: a missing/degenerate payload, a non-array `symbols`, or non-string /
 *  empty entries collapse to an empty list — this is also the fallback when the
 *  CLI predates the `kconfig` subcommand entirely. */
export function kconfigSymbolsFromEnvelope(data: unknown): string[] {
  const payload = (data ?? {}) as KconfigData;
  const symbols = payload.symbols;
  if (!Array.isArray(symbols)) return [];
  return symbols.filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
}
