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
