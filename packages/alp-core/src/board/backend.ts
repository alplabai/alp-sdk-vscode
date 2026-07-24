// SPDX-License-Identifier: Apache-2.0
//
// Pure backend classification from a parsed board.yaml. No fs/yaml here — the
// caller parses; this only inspects the shape. Used to tailor the native-Windows
// bootstrap guidance: Yocto/BitBake is Linux-only (WSL2 permanently), whereas
// Zephyr/baremetal can eventually go native-Windows.

/**
 * True when any core targets Yocto (`os: "yocto"`). Yocto/BitBake requires a
 * Linux host — there is NO native-Windows path for it — so such a project can
 * only be bootstrapped/built under WSL2/Linux, unlike Zephyr/baremetal.
 * Tolerant of a missing/malformed `cores` block (returns false).
 */
export function boardUsesYocto(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const cores = (parsed as { cores?: unknown }).cores;
  if (!cores || typeof cores !== "object") return false;
  return Object.values(cores as Record<string, unknown>).some(
    (c) =>
      !!c && typeof c === "object" && (c as { os?: unknown }).os === "yocto",
  );
}
