// SPDX-License-Identifier: Apache-2.0

/**
 * Pure decision helper for the Diagnostics "Console backend" selector: given
 * the per-core `hwConsole` topology fact (alp-sdk#686) and the current
 * `diagnostics.console` value, decide whether to surface a recommendation
 * and/or a warning. Only `hwConsole === false` (explicit headless) triggers
 * anything — absent/true (has a console UART) is silent.
 */
export interface ConsoleRecommendationCore {
  id: string;
  hwConsole?: boolean;
}

export interface ConsoleRecommendation {
  /** ids of cores explicitly marked headless (`hw_console: false`). */
  headlessIds: string[];
  /** Informational note suggesting `ram`, shown when headless cores exist. */
  recommendation?: string;
  /** Shown in addition to `recommendation` when the current backend can't be
   *  read on the headless core(s) (`uart`/`alp` need a console UART). */
  warning?: string;
}

export function consoleRecommendation(
  cores: ConsoleRecommendationCore[],
  currentConsole: string | undefined,
): ConsoleRecommendation {
  const headlessIds = cores
    .filter((c) => c.hwConsole === false)
    .map((c) => c.id);

  if (headlessIds.length === 0) {
    return { headlessIds };
  }

  const ids = headlessIds.join(", ");
  // Already on `ram` ⇒ the headless core(s) are correctly configured, so don't
  // nag "Recommended: ram". headlessIds still returns (the per-core badge
  // stays); only the redundant recommendation is suppressed.
  const recommendation =
    currentConsole === "ram"
      ? undefined
      : `Recommended: ram — core(s) ${ids} are headless (no console UART); read ram_console_buf over SWD.`;

  const warning =
    currentConsole === "uart" || currentConsole === "alp"
      ? `Output on core(s) ${ids} won't be readable with the "${currentConsole}" backend (no console UART) — switch to ram.`
      : undefined;

  return { headlessIds, recommendation, warning };
}
