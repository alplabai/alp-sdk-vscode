// SPDX-License-Identifier: Apache-2.0
//
// Which `tan doctor` rows a customer about to FLASH needs to have seen (#615).
//
// THE GAP. tan works out, precisely and actionably, that this host cannot
// program the part — and says so in a panel the customer may never open.
// Measured on this bench host at tan 0.6.0 / alp-sdk v0.16.0-rc1:
//
//   name    jlink
//   status  warn
//   scope   host
//   detail  J-Link V9.26 (/usr/local/bin/JLinkExe) predates V9.46, which is
//           where Alif's MRAM flash loader became built in -- Flow D has
//           nothing to program MRAM with on this DLL. […]
//   fix     Upgrade the SEGGER J-Link pack to V9.46+.
//
// On AEN hardware that is the difference between a flash that works and one
// that does not, and the flash path never asked.
//
// WHY A LIST AND NOT "EVERY WARNING". A flash is not the moment to relitigate
// the whole environment: `pythonFloor` warns on this same host and has nothing
// to do with programming a device, and a dialog that cries about everything
// trains the customer to click past the one that mattered. The names below are
// the checks tan reports that bear on WRITING TO A DEVICE. Adding one is a
// deliberate act, not a filter that happens to catch it.
//
// WHY STATUS AND NOT PROSE. `setools` sits at `status: "unknown"` on macOS and
// its own detail says "Nothing to check on this host for THAT path" — a
// non-answer, not a problem. Gating on the status word means that row stays
// silent here and speaks up on a host where tan actually fails it, without this
// file having an opinion about which host that is.

/** The doctor rows that bear on programming a device. */
export const FLASH_READINESS_CHECKS: readonly string[] = ["jlink", "setools"];

/**
 * Statuses that mean "tan looked and did not like what it found".
 *
 * `unknown` is deliberately NOT here. It is tan declining to answer — on this
 * host `setools` is `unknown` because the SE-UART path is Linux-only — and
 * reporting a declined check as a problem is how a warning becomes noise.
 */
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(["warn", "fail"]);

/** One row worth showing before a write. All three strings are tan's. */
export interface FlashReadinessWarning {
  /** `check.name`, verbatim. */
  name: string;
  /** `check.status`, verbatim — never recomputed. */
  status: string;
  /** `check.detail`, verbatim. Display only, never parsed. */
  detail: string | null;
  /** `check.fix`, verbatim, or `null` when tan offered none. */
  fix: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Pick the flash-relevant rows tan is unhappy about, in `FLASH_READINESS_CHECKS`
 * order.
 *
 * `checks` arrives as `unknown` because it comes off an envelope: absent, null,
 * or the wrong type are all possible and none may throw. A doctor that answers
 * nothing produces no warnings — silence here is "tan did not tell us", which
 * must never become "tan said it is fine", and equally must never stop a flash
 * on a host where the check simply did not run.
 */
export function collectFlashReadinessWarnings(
  checks: unknown,
): FlashReadinessWarning[] {
  if (!Array.isArray(checks)) return [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const check of checks) {
    if (!isRecord(check)) continue;
    if (typeof check.name !== "string") continue;
    // FIRST wins: a duplicate name is a malformed envelope, and re-reading the
    // later one would make the warning depend on list order.
    if (!byName.has(check.name)) byName.set(check.name, check);
  }

  const warnings: FlashReadinessWarning[] = [];
  for (const name of FLASH_READINESS_CHECKS) {
    const check = byName.get(name);
    if (!check) continue;
    const status = text(check.status);
    if (!status || !BLOCKING_STATUSES.has(status)) continue;
    warnings.push({
      name,
      status,
      detail: text(check.detail),
      fix: text(check.fix),
    });
  }
  return warnings;
}

/**
 * The one customer-facing sentence, naming the checks rather than quoting them.
 *
 * tan's `detail` runs to several hundred characters and carries absolute paths
 * (`/Users/…/metadata/socs/alif/ensemble/e8.json`), which `planFailure`'s leak
 * filter would demote out of the toast anyway. So the toast names what is
 * wrong and the full text goes to the channel, where `detail` belongs.
 */
export function describeFlashReadiness(
  warnings: readonly FlashReadinessWarning[],
): string {
  const names = warnings.map((warning) => warning.name).join(", ");
  return `Alp: the tan CLI reports a problem that can stop this flash from working (${names}). Flash anyway?`;
}

/**
 * The modal BODY: tan's own words, on the dialog rather than in the channel.
 *
 * Separate from `flashReadinessDetail` on purpose. A customer deciding whether
 * to spend a bench slot on a flash that may not program anything needs the
 * reason in front of them, and `modalDetail` is the field this repo renders on
 * the dialog (`src/notify/vscodeAdapter.ts`). The channel copy still happens —
 * `present` logs `modalDetail` too — so the record survives the click.
 */
export function flashReadinessModalDetail(
  warnings: readonly FlashReadinessWarning[],
): string {
  return warnings
    .map((warning) =>
      [
        `${warning.name}: ${warning.detail ?? "(tan gave no detail)"}`,
        warning.fix ? `Fix: ${warning.fix}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

/** The channel-only record: every string tan produced, unedited. */
export function flashReadinessDetail(
  warnings: readonly FlashReadinessWarning[],
): string {
  return warnings
    .map((warning) =>
      [
        `${warning.name} (${warning.status})`,
        warning.detail,
        warning.fix ? `fix: ${warning.fix}` : null,
      ]
        .filter(Boolean)
        .join(" — "),
    )
    .join("\n");
}
