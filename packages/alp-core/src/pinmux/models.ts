// SPDX-License-Identifier: Apache-2.0

/** One row of a pinmux capability table: an E1M edge pad and the silicon function backing it. */
export interface PinmuxPad {
  e1mPad: string;
  e1mFunction: string;
  owner: string;
  /** Empty string when the pad is plain GPIO (no dedicated peripheral mux). */
  siliconPeripheral: string;
  siliconPad: string;
}

/** Parsed metadata/pinmux/<family>.yaml (pinmux-capability-v1). */
export interface PinmuxTable {
  family: string;
  displayName?: string;
  pads: PinmuxPad[];
}

/**
 * Sentinel `e1m_pad` value for a pad whose physical E1M mapping is not yet
 * characterized. Upstream ships stub capability tables full of these (e.g.
 * v2n.yaml is currently 207 `TBD` pads).
 */
export const UNRESOLVED_E1M_PAD = "TBD";

/**
 * True when `e1mPad` names a real physical pad — not the empty string and not
 * the `TBD` stub sentinel. Pad-ownership (E1M compliance R2) is only checkable
 * for resolved pads; an unresolved pad has no known identity to collide on.
 */
export function isResolvedE1mPad(e1mPad: string): boolean {
  return e1mPad.length > 0 && e1mPad !== UNRESOLVED_E1M_PAD;
}
