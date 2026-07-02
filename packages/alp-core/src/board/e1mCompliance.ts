// SPDX-License-Identifier: Apache-2.0

import { PinmuxPad, PinmuxTable } from "../pinmux/models";
import { BoardConfig, E1mRoutes } from "./models";

/** One E1M-standard compliance finding against a board.yaml. */
export interface E1mComplianceIssue {
  message: string;
  severity: "error" | "warning";
  /** The offending board.yaml token, verbatim — used to locate the diagnostic range. */
  token: string;
}

export interface NormalizedE1mName {
  /** Pinmux-table function name (e.g. "PWM6", "IO3", "ANA_S2"). */
  fn: string;
  /** True for E1M_GPIO_<PAD> secondary usage (standard-compliant per the e1m-spec). */
  gpioSecondary: boolean;
}

const E1M_NAME = /^E1M(_X)?_(GPIO_)?([A-Z0-9_]+)$/;

/**
 * Map a board.yaml E1M reference to its pinmux-table function name.
 * Returns null for names outside the E1M grammar (the JSON schema rejects those).
 */
export function normalizeE1mName(name: string): NormalizedE1mName | null {
  const match = E1M_NAME.exec(name);
  if (!match) {
    return null;
  }

  const gpioSecondary = Boolean(match[2]);
  let fn = match[3];

  const adc = /^ADC(\d+)$/.exec(fn);
  if (adc) {
    fn = `ANA_S${adc[1]}`;
  }

  return { fn, gpioSecondary };
}

/** A function claims every pad it matches exactly or as a prefix (E1M_ENC3 -> ENC3_X + ENC3_Y). */
function padsForFunction(table: PinmuxTable, fn: string): PinmuxPad[] {
  return table.pads.filter(
    (pad) => pad.e1mFunction === fn || pad.e1mFunction.startsWith(`${fn}_`),
  );
}

const ROUTE_SECTIONS: (keyof E1mRoutes)[] = [
  "gpio",
  "buses",
  "pwm",
  "adc",
  "dac",
  "i2s",
  "can",
  "qenc",
];

interface E1mRef {
  name: string;
}

function collectE1mRefs(cfg: BoardConfig): E1mRef[] {
  const refs: E1mRef[] = [];

  if (cfg.e1m_routes) {
    for (const section of ROUTE_SECTIONS) {
      for (const entry of cfg.e1m_routes[section] ?? []) {
        if (entry && typeof entry.e1m === "string") {
          refs.push({ name: entry.e1m });
        }
      }
    }
  }

  for (const pin of cfg.pins ?? []) {
    if (typeof pin === "string") {
      refs.push({ name: pin });
    } else if (pin && typeof pin.e1m === "string") {
      refs.push({ name: pin.e1m });
    }
  }

  return refs;
}

/**
 * Check every E1M pad reference in the board config against the SoM family's
 * pinmux capability table.  Rules:
 *   R1 (error): the referenced function does not exist on this family.
 *   R2 (error): two different references claim the same physical pad.
 */
export function checkE1mCompliance(
  cfg: BoardConfig,
  table: PinmuxTable,
): E1mComplianceIssue[] {
  const issues: E1mComplianceIssue[] = [];
  const claims = new Map<string, string>();

  for (const ref of collectE1mRefs(cfg)) {
    const normalized = normalizeE1mName(ref.name);
    if (!normalized) {
      continue;
    }

    const pads = padsForFunction(table, normalized.fn);
    if (pads.length === 0) {
      issues.push({
        message: `${ref.name}: E1M function "${normalized.fn}" is not available on the ${table.family} SoM family.`,
        severity: "error",
        token: ref.name,
      });
      continue;
    }

    for (const pad of pads) {
      const existing = claims.get(pad.e1mPad);
      if (existing && existing !== ref.name) {
        issues.push({
          message: `${ref.name}: E1M pad ${pad.e1mPad} is already claimed by ${existing} — the E1M standard allows one owner per pad.`,
          severity: "error",
          token: ref.name,
        });
      } else {
        claims.set(pad.e1mPad, ref.name);
      }
    }
  }

  return issues;
}
