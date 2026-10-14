// SPDX-License-Identifier: Apache-2.0
//
// The serial ports `tan monitor` offers, and the baud rates a user picks from
// (#552).
//
// ── Why this module reads tan's list instead of enumerating ports itself ────
//
// Enumerating serial ports is a per-platform job — `/dev/cu.*` on darwin,
// `/dev/ttyUSB*` + `/dev/ttyACM*` on linux, a registry read on win32 — and
// this extension has no native module to do it. It does not need one: run
// `tan monitor --format json` with no `--port` and tan refuses with
// `monitor.no-port` and hands back the list in `data.availablePorts`.
//
// So the port list is a fact tan owns, and nothing here re-derives it. That is
// the same rule `src/deps/vscodeAdapter.ts` states for the dependency table,
// and it is the rule that keeps a second, quietly-diverging answer from
// existing. Where tan is silent the cell is null and the fix is an issue
// against tan-cli, not a TypeScript computation.
//
// ── Why the picker never picks for the user ─────────────────────────────────
//
// Because the first port in the list is routinely not a board. Measured on a
// developer macOS host with no target attached, `tan monitor --format json`
// returned five ports, none of them a console:
//
//   /dev/cu.debug-console        /dev/cu.Bluetooth-Incoming-Port
//   /dev/cu.soundcoreR50i        /dev/cu.HUAWEIFreeBuds6i
//   /dev/cu.MixPodsPro
//
// Three are Bluetooth audio devices. On the AEN801 bench the same trap has a
// worse ending: `/dev/ttyACM0` there is the DPS-150 programmable power supply,
// not a console, and the app console is UART5 with the SE-UART a third device
// again. A default-to-first picker would open a session against a PSU.
//
// Pure — no `vscode`, no `fs`, no `child_process`.

import type { TanPayloadShape } from "../tanPayloadShape";

/** tan's refusal when `monitor` is run without `--port`. It is the SUCCESS
 *  path for the port-listing call: the list rides along with the refusal.
 *
 *  Classified on the CODE, never the prose — the message spells the whole list
 *  into one sentence and its wording is not a contract. */
export const MONITOR_NO_PORT_CODE = "monitor.no-port";

/** The one field this repo reads off the `monitor` payload. Checked through
 *  the same `checkTanPayload` every other tan payload goes through, so a
 *  renamed field becomes a message rather than an empty picker. */
export const MONITOR_PORTS_SHAPE: TanPayloadShape = {
  availablePorts: "array",
};

/** One serial port as tan reported it.
 *
 *  `description` is nullable because a missing one is left missing. tan sends
 *  the literal string `"n/a"` when it has nothing, and that is tan's word, not
 *  ours to invent when the field is absent entirely. */
export interface SerialPortChoice {
  readonly device: string;
  readonly description: string | null;
}

/**
 * Narrow `data.availablePorts` to the entries this repo can actually use.
 *
 * DROP, never coerce. An entry without a usable `device` is dropped rather
 * than repaired into one, because the only repair available would be to invent
 * a device path, and a picker entry that names a port that does not exist is
 * worse than a shorter list. A non-string `description` is dropped to null for
 * the same reason — it is decoration, so losing it costs a hint, while
 * stringifying an object would print `[object Object]` next to a real port.
 *
 * The element check stops there on purpose. `tanPayloadShape.ts`'s header
 * argues element shapes should NOT be checked, and it is right for payloads
 * this repo passes through; this one is the exception it names by implication,
 * because both fields are READ here and an unreadable element becomes a broken
 * row on screen rather than a field nobody touched.
 */
export function narrowSerialPorts(value: unknown): SerialPortChoice[] {
  if (!Array.isArray(value)) return [];
  const ports: SerialPortChoice[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const device = record.device;
    if (typeof device !== "string" || device.trim() === "") continue;
    const description = record.description;
    ports.push({
      device,
      description: typeof description === "string" ? description : null,
    });
  }
  return ports;
}

/** tan's own default, verbatim from `tan monitor --help` at the pinned
 *  `0.6.0`: `--baud <int>  Baud rate. [default: 115200]`. Repeated here so the
 *  picker can PRESELECT it; the argv still sends it explicitly, because a
 *  default that moves upstream should change what tan does, not silently
 *  change what the user thought they picked. */
export const DEFAULT_MONITOR_BAUD = 115200;

/**
 * The rates offered, and why two of them carry a note.
 *
 * These are the standard rates, not a per-board table — this repo does not
 * know which console a user just flashed. Two are annotated from measured
 * bench facts because getting them wrong produces silence rather than an
 * error, which reads as "the board is dead":
 *
 *   115200  the AEN app console (UART5)
 *   57600   the AEN SE-UART, a different device on the same board
 *
 * A user who picks the SE-UART device at tan's default 115200 sees nothing at
 * all. The note is the whole reason this is a picker and not a fixed value.
 */
export const MONITOR_BAUD_CHOICES: readonly {
  readonly baud: number;
  readonly note: string | null;
}[] = Object.freeze([
  { baud: 9600, note: null },
  { baud: 19200, note: null },
  { baud: 38400, note: null },
  { baud: 57600, note: "the AEN SE-UART runs at this rate" },
  { baud: 115200, note: "tan's default, and the AEN app console (UART5)" },
  { baud: 230400, note: null },
  { baud: 460800, note: null },
  { baud: 921600, note: null },
]);

/** A baud tan will accept on `--baud <int>`: a positive, finite integer.
 *  Guards the custom-entry path, where the user types the value. */
export function isValidBaud(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
