// SPDX-License-Identifier: Apache-2.0

import { BoardConfig } from "./models";

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
      const libraries = core.libraries ?? [];
      const hasTlsLib = TLS_LIBRARIES.some((lib) => libraries.includes(lib));
      if (!hasTlsLib) {
        errors.push(
          `core ${coreId}: iot.tls requires 'mbedtls' or 'bearssl' in libraries.`,
        );
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
