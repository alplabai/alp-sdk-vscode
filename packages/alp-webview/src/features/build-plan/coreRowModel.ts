// SPDX-License-Identifier: Apache-2.0
//
// What one core's row says, derived once from the manifest slice and its
// `tan size` report — pure, so the figures a row prints can be asserted
// without a render. CoreRows.tsx only lays these out.
//
// THESE FIGURES ARE FIRMWARE FACTS. The row prints the rounded figure a
// reader scans (`96.1 KiB of 2.63 MiB`); the exact hex (`0x18068 of
// 0x2a0000`) is one disclosure away in the same row, never dropped. A null
// measurement prints as "unknown", never as 0.

import type { ManifestSlice, SizeRegion, SliceSize } from "../../types";
import { splitBytes } from "./format";

/** A `flash_method` or path the manifest has actually resolved, not its
 *  placeholder. */
export const isReady = (value?: string | null): boolean =>
  !!value && value !== "TBD";

const hex = (bytes: number): string => `0x${bytes.toString(16)}`;

/** Said in words as well as colour: a bar that turns amber is easy to
 *  miss, and a colour alone fails a monochrome screen. */
const VERDICT: Partial<Record<SliceSize["status"], string>> = {
  warn: "near budget",
  over: "over budget",
};

/** Row colour for a slice status: the dot and the status word share it. */
export type StatusKind = "ok" | "warn" | "err" | "off";

const STATUS_KIND: Record<string, StatusKind> = {
  ok: "ok",
  skipped: "warn",
  pending: "warn",
  failed: "err",
  error: "err",
  off: "off",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Built",
  skipped: "Skipped",
  pending: "Pending",
  failed: "Failed",
  error: "Failed",
  off: "Off",
};

export interface CoreMeter {
  label: "Flash" | "RAM";
  /** `96.1 KiB`, or "unknown" when `tan size` measured nothing. */
  usedText: string;
  /** `2.63 MiB`, or null when no budget resolved. */
  totalText: string | null;
  pct: number | null;
  verdict: string | null;
  /** `0x18068 of 0x2a0000` — the exact figures, for the details. */
  exactText: string | null;
}

export interface CoreDetail {
  label: string;
  value: string;
  /** Prose reads in the UI font; identifiers, paths and hex stay mono. */
  prose: boolean;
}

export interface CoreRow {
  id: string;
  /** `zephyr · arm-zephyr-eabi`; the toolchain is omitted for an `off`
   *  slice (it never builds) and said to be "not reported" when the
   *  manifest carries none. */
  subtitle: string;
  statusKind: StatusKind;
  statusLabel: string;
  /** Why the slice is not built, verbatim from the producer; null for a
   *  built slice, and null for one that gave no reason (the status word
   *  alone is then the whole statement). */
  problem: string | null;
  /** The slice can be flashed from this panel: it has a resolved flash
   *  method, it is active, and it was built. */
  flashable: boolean;
  /** Null when `tan size` has no measurement for this core — the row then
   *  prints `measureNote` in the meters' place: `tan size`'s own budget
   *  note, "Not measured" for a built slice it did not measure, or the
   *  slice's status word for one that never built. */
  meters: CoreMeter[] | null;
  measureNote: string | null;
  details: CoreDetail[];
}

function meterOf(
  label: CoreMeter["label"],
  region: SizeRegion,
  status: SliceSize["status"],
): CoreMeter {
  const usedText =
    region.used === null ? "unknown" : splitBytes(region.used).text;
  const totalText =
    region.total === null ? null : splitBytes(region.total).text;
  const exactText =
    region.used === null
      ? null
      : region.total === null
        ? hex(region.used)
        : `${hex(region.used)} of ${hex(region.total)}`;
  return {
    label,
    usedText,
    totalText,
    pct: region.pct,
    verdict: VERDICT[status] ?? null,
    exactText,
  };
}

/** A flash argument as text: scalars as written, anything else as JSON. */
function argText(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

function detailsOf(
  slice: ManifestSlice,
  size: SliceSize | undefined,
  meters: CoreMeter[] | null,
): CoreDetail[] {
  const mono = (label: string, value: string | null | undefined) =>
    value ? [{ label, value, prose: false }] : [];
  const prose = (label: string, value: string | null | undefined) =>
    value ? [{ label, value, prose: true }] : [];
  const args = Object.entries(slice.flash_args ?? {}).flatMap(([k, v]) =>
    mono(k, argText(v)),
  );
  return [
    ...mono("Board", slice.board),
    ...mono("Machine", slice.machine),
    ...mono("Image", slice.image),
    ...mono("App", slice.app),
    ...mono("Output", slice.output_artefact),
    ...mono("Build dir", slice.build_dir),
    ...mono("Log", slice.log_path),
    ...mono("Flash method", slice.flash_method),
    ...args,
    ...(meters ?? []).flatMap((m) =>
      mono(`${m.label} used (exact)`, m.exactText),
    ),
    ...prose("Size source", size?.source),
    ...prose("Size note", size?.budget_note),
    ...(size?.notes ?? []).flatMap((n) => prose("Note", n)),
  ];
}

export function coreRowOf(
  slice: ManifestSlice,
  size: SliceSize | undefined,
): CoreRow {
  const active = slice.os !== "off";
  const built = slice.status === "ok";
  // An off slice is off whatever status word it carries: it never builds.
  const statusKind = active ? (STATUS_KIND[slice.status] ?? "warn") : "off";
  const toolchain = slice.toolchain ?? "not reported";
  const measured =
    size !== undefined && size.status !== "not-built" && size.status !== "n/a";
  const meters = measured
    ? [
        meterOf("Flash", size.flash, size.status),
        meterOf("RAM", size.ram, size.status),
      ]
    : null;
  const measureNote = measured
    ? null
    : (size?.budget_note ?? (built && active ? "Not measured" : null));
  return {
    id: slice.core_id,
    subtitle: active ? `${slice.os} · ${toolchain}` : slice.os,
    statusKind,
    statusLabel: STATUS_LABEL[slice.status] ?? slice.status,
    problem: built || !active ? null : (slice.reason ?? null),
    flashable: active && built && isReady(slice.flash_method),
    meters,
    measureNote,
    details: detailsOf(slice, size, meters),
  };
}
