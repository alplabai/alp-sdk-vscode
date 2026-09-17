// SPDX-License-Identifier: Apache-2.0
//
// Number formatting shared by the Build Plan panel's two readers of the same
// manifest: the slice list (footprints) and the memory map (extents).

/** `99452` -> `97.1 KiB`. Bytes are what tan reports and what a linker map
 *  shows, so both are rendered — the exact figure is the one you act on. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

/**
 * An address, in the spelling the SDK's own metadata uses: lowercase hex,
 * `0x`-prefixed, padded to at least eight digits.
 *
 * Padding matters on this screen: `0x8057800` and `0x80578000` differ by a
 * factor of sixteen and by one glance. Addresses wider than 32 bits keep their
 * own width rather than being truncated to the pad.
 */
export function formatAddress(address: number): string {
  return `0x${address.toString(16).padStart(8, "0")}`;
}
