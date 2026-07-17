// SPDX-License-Identifier: Apache-2.0

import { BoardConfig, librariesForCore } from "./models";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Libraries that satisfy a core's `iot.tls: true` requirement. */
const TLS_LIBRARIES = ["mbedtls", "bearssl"];

/**
 * Cross-field validation that mirrors the rules the SDK's
 * validate_board_yaml.py enforces beyond the JSON schema. Structural
 * validation (types, enums, required leaf fields) is handled by the vendored
 * board.schema.json in the YAML editor; this covers the relational rules the
 * configurator surfaces in its validation panel.
 */
export function validateBoardConfig(cfg: BoardConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cfg.som || !cfg.som.sku) {
    errors.push("som.sku is required.");
  }

  if (!cfg.cores || Object.keys(cfg.cores).length === 0) {
    errors.push("cores must declare at least one core.");
  }

  const hasInline = cfg.populated !== undefined || cfg.e1m_routes !== undefined;
  if (cfg.preset !== undefined && hasInline) {
    errors.push(
      "preset is mutually exclusive with inline populated / e1m_routes.",
    );
  }

  for (const [coreId, core] of Object.entries(cfg.cores ?? {})) {
    if (core.iot?.tls) {
      const libraries = librariesForCore(cfg.libraries, coreId);
      const hasTlsLib = TLS_LIBRARIES.some((lib) => libraries.includes(lib));
      if (!hasTlsLib) {
        errors.push(
          `core ${coreId}: iot.tls requires 'mbedtls' or 'bearssl' in libraries.`,
        );
      }
    }
  }

  // IPC carve-outs: the SDK schema requires each channel to name at least two
  // endpoints (minItems: 2), and validate_board_yaml.py rejects an endpoint that
  // does not reference a declared core. Catch both here so the configurator flags
  // them before the board.yaml is fed to the SDK (issue #109 Bug B) — otherwise
  // the failure only surfaces later as `ipc/*/endpoints: [...] is too short` or an
  // unknown-core reference from `alp build --plan`.
  const declaredCores = new Set(Object.keys(cfg.cores ?? {}));
  for (const entry of cfg.ipc ?? []) {
    const label = entry.name ? `ipc '${entry.name}'` : "ipc channel";
    const endpoints = entry.endpoints ?? [];
    if (endpoints.length < 2) {
      errors.push(
        `${label}: needs at least 2 endpoints (has ${endpoints.length}).`,
      );
    }
    for (const endpoint of endpoints) {
      if (!declaredCores.has(endpoint)) {
        errors.push(`${label}: endpoint '${endpoint}' is not a declared core.`);
      }
    }
  }

  // NB: `boot.method: mcuboot` without `boot.signing` is VALID — the SDK applies
  // the SoM family's default signing (AEN -> ECDSA-P256, V2N -> RSA-2048). The
  // SDK only rejects a signing *algorithm* that's unsupported for the family,
  // which the full `alp validate` (Python SDK) checks; flagging missing signing
  // here was a false positive.

  return { errors, warnings };
}
