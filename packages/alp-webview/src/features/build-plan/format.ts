// SPDX-License-Identifier: Apache-2.0
//
// Number formatting shared by the Build Plan panel's two readers of the same
// manifest: the slice list (footprints) and the memory map (extents).
//
// THESE FIGURES ARE FIRMWARE FACTS. A rounded size or a dropped digit is the
// difference between flashing the right slot and the wrong one, so every
// helper here either prints a number exactly or prints the exact figure
// beside the rounded one — never a rounded figure alone.

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** The narrowest an address is ever printed, in hex digits: 32 bits. */
const MIN_ADDRESS_DIGITS = 8;

const UNITS: ReadonlyArray<{ size: number; name: string; digits: number }> = [
  { size: GIB, name: "GiB", digits: 2 },
  { size: MIB, name: "MiB", digits: 2 },
  { size: KIB, name: "KiB", digits: 1 },
];

/**
 * A byte count in the largest binary unit its ROUNDED figure reaches — the
 * unit is chosen after rounding, so 1048575 B prints `1.00 MiB (0xfffff)`,
 * never `1024.0 KiB`.
 *
 * A rounded figure that is EXACT prints alone — `64 KiB`, `4 GiB`,
 * `5.50 MiB`. One that loses bytes prints the exact hex beside it:
 * `2.63 MiB (0x2a0000)` — the rounded figure is for reading at a glance,
 * the hex is the one a linker map and a flash tool agree on. Below 1 KiB
 * the count is already exact (`99 B`).
 */
export function formatBytes(bytes: number): string {
  for (const unit of UNITS) {
    const fixed = (bytes / unit.size).toFixed(unit.digits);
    // Below 1 KiB the byte count itself is printed — never `1.0 KiB` for
    // 1023 B. Above it, a figure that rounds up to the next unit moves up.
    if (Number(fixed) < 1 || bytes < KIB) continue;
    const value = Number(fixed);
    const isExact = value * unit.size === bytes;
    const shown = Number.isInteger(value) ? String(value) : fixed;
    return isExact
      ? `${shown} ${unit.name}`
      : `${fixed} ${unit.name} (0x${bytes.toString(16)})`;
  }
  return `${bytes} B`;
}

/**
 * An address, in the spelling the SDK's own metadata uses: lowercase hex,
 * `0x`-prefixed, padded to at least eight digits.
 *
 * Padding matters on this screen: `0x8057800` and `0x80578000` differ by a
 * factor of sixteen and by one glance. The pad is a FLOOR — an address past
 * 2^32 keeps its own natural width (`0x147ffffff`) rather than being
 * truncated, and 32-bit peers are not up-padded to match it.
 *
 * NUMBER-BASED: addresses are JavaScript numbers, exact only up to 2^53.
 * An address above that loses its low bits before it ever reaches this
 * function; no SoM this panel resolves comes near it.
 */
export function formatAddress(address: number): string {
  return `0x${address.toString(16).padStart(MIN_ADDRESS_DIGITS, "0")}`;
}

/**
 * A half-open extent `[lo, hiExclusive)` printed with its INCLUSIVE last
 * byte: `0x80010000 – 0x802affff`, never the unlabelled exclusive end
 * `0x802b0000`, which names the first byte of whatever comes next. An empty
 * or single-point extent (`hiExclusive <= lo + 1`) prints as one address.
 */
export function formatRange(lo: number, hiExclusive: number): string {
  if (hiExclusive <= lo + 1) return formatAddress(lo);
  return `${formatAddress(lo)} – ${formatAddress(hiExclusive - 1)}`;
}

/** A device-relative offset, exactly: `+0x10000`, never a rounded unit. */
export function formatOffset(offset: number): string {
  return `+0x${offset.toString(16)}`;
}

/**
 * A device-relative half-open extent `[lo, hiExclusive)` as exact hex
 * offsets with an inclusive last byte: `+0x10000 – +0x1ffff`. An offset is
 * written exactly, never rounded to a unit — it is where a flash tool seeks.
 */
export function formatOffsetRange(lo: number, hiExclusive: number): string {
  if (hiExclusive <= lo + 1) return formatOffset(lo);
  return `${formatOffset(lo)} – ${formatOffset(hiExclusive - 1)}`;
}
