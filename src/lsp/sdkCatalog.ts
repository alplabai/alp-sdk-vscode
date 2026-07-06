// SPDX-License-Identifier: Apache-2.0
//
// Derives the concrete board.yaml value lists the LSP completes against — SoM
// SKUs and curated libraries — from the SELECTED SDK's P/M/T metadata rather
// than a hardcoded table, so the lists track whatever SDK is active. The scan
// is run once per activation / SDK switch and cached by the server (see
// server.ts); it never runs per document open.

import * as fs from "fs";
import * as path from "path";

/** Concrete value lists derived from an SDK's `metadata/`, fed to board.yaml
 *  completion/hover so `som.sku` / `libraries[]` reflect the active SDK. */
export interface SdkCompletionCatalog {
  /** SoM SKUs, one per `metadata/e1m_modules/<SKU>.yaml`. */
  skus: readonly string[];
  /** Curated library names, one per `metadata/libraries/<name>.yaml`. */
  libraries: readonly string[];
}

/** The degraded catalog used before the first scan / when no SDK is selected. */
export const EMPTY_SDK_CATALOG: SdkCompletionCatalog = {
  skus: [],
  libraries: [],
};

/** Map metadata directory listings to a catalog. Pure (no fs): a file
 *  `E1M-AEN701.yaml` yields the SKU `E1M-AEN701`; non-`.yaml` and `README*`
 *  entries are dropped, and the result is sorted + de-duplicated. */
export function deriveSdkCatalog(
  e1mModuleFiles: readonly string[],
  libraryFiles: readonly string[],
): SdkCompletionCatalog {
  return {
    skus: yamlStems(e1mModuleFiles),
    libraries: yamlStems(libraryFiles),
  };
}

function yamlStems(files: readonly string[]): string[] {
  const stems = files
    .filter(
      (name) =>
        name.endsWith(".yaml") && !name.toLowerCase().startsWith("readme"),
    )
    .map((name) => name.slice(0, -".yaml".length));
  return [...new Set(stems)].sort();
}

/** Scan `<sdkRoot>/metadata/{e1m_modules,libraries}` for the completion catalog.
 *  A missing SDK, missing dirs, or an unreadable tree degrades to empty lists —
 *  this never throws (the LSP falls back to its built-in defaults). */
export function scanSdkCompletionCatalog(
  sdkRoot: string | null | undefined,
): SdkCompletionCatalog {
  if (!sdkRoot) {
    return EMPTY_SDK_CATALOG;
  }
  const metadata = path.join(sdkRoot, "metadata");
  return deriveSdkCatalog(
    readDirSafe(path.join(metadata, "e1m_modules")),
    readDirSafe(path.join(metadata, "libraries")),
  );
}

function readDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
