// SPDX-License-Identifier: Apache-2.0
//
// Pure parse + version-guard for `build/system-manifest.yaml`. Mirrors the Rust
// `parse_system_manifest` (cli-rs/crates/alp-core/src/system_manifest.rs).

import * as yaml from "js-yaml";

import {
  ManifestHwInfo,
  SystemManifest,
  SYSTEM_MANIFEST_SCHEMA_VERSION,
} from "./models";

export class SystemManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemManifestError";
  }
}

/**
 * Parse + version-guard a system-manifest YAML document. Pure: no IO.
 * Tolerant — unknown additive-v1 fields are ignored, not rejected (alp-sdk#106
 * stability policy). Throws `SystemManifestError` on bad YAML or a
 * `schema_version` this build doesn't consume.
 */
export function parseSystemManifest(text: string): SystemManifest {
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(text) ?? {}) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SystemManifestError(
      `system-manifest is not valid YAML: ${message}`,
    );
  }

  const version =
    typeof doc.schema_version === "number" ? doc.schema_version : NaN;
  if (version !== SYSTEM_MANIFEST_SCHEMA_VERSION) {
    throw new SystemManifestError(
      `unsupported system-manifest schema_version ${
        Number.isNaN(version) ? "(missing)" : version
      } (this build consumes v${SYSTEM_MANIFEST_SCHEMA_VERSION}); upgrade the extension or the SDK`,
    );
  }

  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    schema_version: version,
    generated_by: typeof doc.generated_by === "string" ? doc.generated_by : "",
    hw_info: (doc.hw_info ?? { sku: "" }) as ManifestHwInfo,
    slices: arr(doc.slices) as SystemManifest["slices"],
    ipc: arr(doc.ipc) as SystemManifest["ipc"],
    helper_mcus: arr(doc.helper_mcus) as SystemManifest["helper_mcus"],
    boot_order: arr(doc.boot_order),
    storage: Array.isArray(doc.storage) ? doc.storage : undefined,
  };
}

/**
 * The `core_id`s of a manifest's Zephyr slices, in manifest order.
 *
 * Pure so the surface keeps only the `fs` read: reading and parsing
 * `build/system-manifest.yaml` had grown three hand-rolled copies (the debug
 * slice resolver, the build-plan panel, and the Renode core picker), which is
 * what CLAUDE.md's "no cross-slice copy-paste of domain rules" forbids.
 *
 * Every Zephyr slice is listed regardless of `status`. A `failed`/`skipped`
 * slice is still a real core the user may want to point a tool at, and the
 * tool is the one that knows whether it can act on it — the CLI already
 * refuses a stale artefact with a message naming the reason. Filtering here
 * would replace that message with an absence.
 */
export function zephyrCoreIds(manifest: SystemManifest): string[] {
  return manifest.slices
    .filter((slice) => slice.os === "zephyr")
    .map((slice) => slice.core_id);
}
