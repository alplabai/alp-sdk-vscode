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
  /** Key absent: a tan that predates `tan platform`. Feature hidden. */
  | { kind: "unsupported" }
  /** `null`: tan supports platforms, the workspace has no pin. */
  | { kind: "none" }
  | { kind: "pin"; pin: PlatformPin }
  | { kind: "malformed" };

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** §1 grammar: `YY.M.MICRO[-rcN]`, month 1..12 never zero-padded. */
const VERSION_RE = /^(\d{2})\.([1-9]|1[0-2])\.(0|[1-9]\d*)(-rc[1-9]\d*)?$/;
const LINE_RE = /^(\d{2})\.([1-9]|1[0-2])$/;
export const isPlatformVersion = (v: unknown): v is string =>
  typeof v === "string" && VERSION_RE.test(v);
export const isPlatformLine = (v: unknown): v is string =>
  typeof v === "string" && LINE_RE.test(v);
/** A line or a full version: what `tan platform use` accepts as a release. */
export const isPlatformTarget = (v: unknown): v is string =>
  isPlatformVersion(v) || isPlatformLine(v);

/**
 * Narrow `data.platform`. Absent = `unsupported` (older tan), `null` = `none`;
 * a wrong top-level shape or a `version`/`line` outside the §1 grammar =
 * `malformed` (caller logs once, shows nothing). A bad component entry is
 * skipped, not fatal. Extra fields are ignored.
 */
export function readPlatform(value: unknown): PlatformRead {
  if (value === undefined) return { kind: "unsupported" };
  if (value === null) return { kind: "none" };
  if (typeof value !== "object") return { kind: "malformed" };
  const p = value as Record<string, unknown>;
  if (
    !isPlatformVersion(p.version) ||
    !isPlatformLine(p.line) ||
    !Array.isArray(p.components)
  ) {
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
      continue;
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

export function statusBarText(pin: PlatformPin | null): string {
  return pin ? `Alp Platform ${pin.version}` : "Alp Platform: none";
}

export function warningMessage(pin: PlatformPin): string {
  const list = mismatches(pin)
    .map((c) => `${c.name} ${c.installed ?? "?"} (pinned ${c.pinned})`)
    .join(", ");
  return `This workspace is off the Alp Platform ${pin.version} manifest: ${list}.`;
}

// ── `tan platform list` ──────────────────────────────────────────────────────

export interface PlatformRelease {
  version: string;
  line: string;
  prerelease: boolean;
  published: string | null;
}

export interface PlatformList {
  releases: PlatformRelease[];
  pinned: string | null;
}

/** Compare §1 versions: numeric (YY, M, MICRO); an `-rcN` sorts before its GA. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = VERSION_RE.exec(v);
    return m
      ? [+m[1], +m[2], +m[3], m[4] ? +m[4].slice(3) : Infinity]
      : [0, 0, 0, 0];
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 4; i += 1) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/** Tolerant read of `tan platform list` `data`; null when it is not a list.
 *  Entries outside the §1 grammar are skipped. */
export function readPlatformList(data: unknown): PlatformList | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.releases)) return null;
  const releases: PlatformRelease[] = [];
  for (const r of d.releases) {
    const e = r as Record<string, unknown> | null;
    if (!e || !isPlatformVersion(e.version) || !isPlatformLine(e.line))
      continue;
    releases.push({
      version: e.version,
      line: e.line,
      prerelease: e.prerelease === true,
      published: typeof e.published === "string" ? e.published : null,
    });
  }
  return {
    releases,
    pinned: typeof d.pinned === "string" ? d.pinned : null,
  };
}

/**
 * Releases to offer, newest first. Default: one entry per line, its newest GA
 * MICRO. `all`: every version, release candidates included.
 */
export function switchCandidates(
  list: PlatformList,
  all: boolean,
): PlatformRelease[] {
  const sorted = [...list.releases].sort((a, b) =>
    compareVersions(b.version, a.version),
  );
  if (all) return sorted;
  const seen = new Set<string>();
  return sorted.filter((r) => {
    if (r.prerelease || seen.has(r.line)) return false;
    seen.add(r.line);
    return true;
  });
}

/** True when `tan platform list` failed for a token / 403 / 404 reason (the
 *  manifest repo is private for now). Matched on code AND message: tan owns
 *  the exact issue code, and this must not depend on guessing it. */
export function isListAccessIssue(
  issues: ReadonlyArray<{ code: string; message: string }>,
): boolean {
  return issues.some((i) =>
    /token|403|404|unauthori[sz]ed|forbidden|not.?found/i.test(
      `${i.code} ${i.message}`,
    ),
  );
}

// ── The quick-pick menu ──────────────────────────────────────────────────────

export type PlatformAction = "switch" | "reapply" | "clear" | "open";

export interface PlatformMenuItem {
  label: string;
  description?: string;
  /** A non-selectable heading line. */
  separator?: boolean;
  action?: PlatformAction;
}

const STATUS_ICON: Record<string, string> = {
  match: "$(check)",
  mismatch: "$(warning)",
};

/** `pin` null = no pin: only the switch action applies. */
export function platformMenu(pin: PlatformPin | null): PlatformMenuItem[] {
  if (!pin) {
    return [
      { label: "No platform pin in this workspace", separator: true },
      { label: "$(sync) Switch platform release…", action: "switch" },
    ];
  }
  const items: PlatformMenuItem[] = [
    {
      label: `Alp Platform ${pin.version}`,
      description: `line ${pin.line}`,
      separator: true,
    },
    ...pin.components.map((c) => ({
      label: `${STATUS_ICON[c.status] ?? "$(question)"} ${c.name}`,
      description: `${c.status} — installed ${c.installed ?? "unknown"}, pinned ${c.pinned}`,
    })),
    { label: "Actions", separator: true },
    { label: "$(sync) Switch platform release…", action: "switch" },
    {
      label: "$(refresh) Re-apply pinned release",
      description: `tan platform use ${pin.version}`,
      action: "reapply",
    },
    { label: "$(trash) Clear platform pin", action: "clear" },
    { label: "$(go-to-file) Open manifest", action: "open" },
  ];
  return items;
}
