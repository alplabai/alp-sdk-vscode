// SPDX-License-Identifier: Apache-2.0
//
// Alp Platform pin, as `tan doctor` reports it in `data.platform`
// (alp-platform contract v1 §6, alplabai/alp-sdk-vscode#718). tan owns the
// manifest; this only narrows the wire value and decides what to show. Pure:
// no vscode, no fs.
//
// Deliberately NOT a key on `DoctorEnvelopeData` (`../cli/doctorEnvelope`):
// that interface is gated against the PINNED tan's frozen `dataKeys`, and an
// older tan has no `platform`. Read it as `unknown` and narrow it here.

/** The component the extension fills in itself (tan reports it `unknown`). */
export const OWN_COMPONENT = "alp-sdk-vscode";

export interface PlatformComponent {
  name: string;
  pinned: string;
  installed: string | null;
  /** `match` | `mismatch` | `unknown`, verbatim from tan. */
  status: string;
}

export interface PlatformPin {
  version: string;
  line: string;
  components: PlatformComponent[];
}

export type PlatformRead =
  | { kind: "none" }
  | { kind: "pin"; pin: PlatformPin }
  | { kind: "malformed" };

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * Narrow `data.platform`. Missing or null = no pin (an older tan, or no pin);
 * a wrong shape = `malformed` (caller logs, shows nothing). Extra fields are
 * ignored.
 */
export function readPlatform(value: unknown): PlatformRead {
  if (value === undefined || value === null) return { kind: "none" };
  if (typeof value !== "object") return { kind: "malformed" };
  const p = value as Record<string, unknown>;
  if (!isStr(p.version) || !isStr(p.line) || !Array.isArray(p.components)) {
    return { kind: "malformed" };
  }
  const components: PlatformComponent[] = [];
  for (const c of p.components) {
    const e = c as Record<string, unknown> | null;
    if (
      !e ||
      !isStr(e.name) ||
      !isStr(e.pinned) ||
      !isStr(e.status) ||
      (e.installed !== null && typeof e.installed !== "string")
    ) {
      return { kind: "malformed" };
    }
    components.push({
      name: e.name,
      pinned: e.pinned,
      installed: e.installed,
      status: e.status,
    });
  }
  return {
    kind: "pin",
    pin: { version: p.version, line: p.line, components },
  };
}

const bare = (v: string) => v.replace(/^v/, "");

/** Fill the extension's own component with its own version and recompute its
 *  status (same rule as tan: leading `v` ignored, full string compared). */
export function withOwnVersion(
  pin: PlatformPin,
  ownVersion: string,
): PlatformPin {
  return {
    ...pin,
    components: pin.components.map((c) =>
      c.name === OWN_COMPONENT
        ? {
            ...c,
            installed: ownVersion,
            status: bare(ownVersion) === bare(c.pinned) ? "match" : "mismatch",
          }
        : c,
    ),
  };
}

export function mismatches(pin: PlatformPin): PlatformComponent[] {
  return pin.components.filter((c) => c.status === "mismatch");
}

/** Stable key of a mismatch set, for show-once-per-set dedupe. "" = none. */
export function mismatchKey(pin: PlatformPin): string {
  return mismatches(pin)
    .map((c) => `${c.name}:${c.installed}->${c.pinned}`)
    .join("|");
}

export function statusBarText(pin: PlatformPin): string {
  return `Alp Platform ${pin.version}`;
}

export function warningMessage(pin: PlatformPin): string {
  const list = mismatches(pin)
    .map((c) => `${c.name} ${c.installed ?? "?"} (pinned ${c.pinned})`)
    .join(", ");
  return `This workspace is off the Alp Platform ${pin.version} manifest: ${list}.`;
}
