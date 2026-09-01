// SPDX-License-Identifier: Apache-2.0
//
// `Alp: Open serial monitor` — the observe step of the loop (#552).
//
// Setup, create, configure, build and flash all have a GUI path. Watching the
// board say something back did not, so the workflow ejected the user into a
// terminal at the exact moment their firmware started talking.
//
// ── The refusal IS the success path ─────────────────────────────────────────
//
// `tan monitor` needs a `--port` and this repo cannot guess one. Run it with
// no port and `--format json` and tan refuses with `monitor.no-port` — and
// carries the port list back in `data.availablePorts`. So the listing call is
// a call that is EXPECTED to come back `ok: false`, and the branch that reads
// its payload is the branch that succeeded.
//
// That is why `hasIssueCode` is checked BEFORE the outcome is treated as a
// failure. Classified on the code, never on the prose: tan spells the whole
// port list into that message, and its wording is not a contract.
//
// ── Nothing here picks a port ───────────────────────────────────────────────
//
// See `@alp-sdk/core/monitor/ports` for the measurement, but the short of it:
// the first port in the list is routinely not a board, and on the AEN801 bench
// `/dev/ttyACM0` is the DPS-150 programmable power supply. A default-to-first
// picker opens a session against a PSU. The user picks, every time.

import { checkTanPayload } from "@alp-sdk/core/tanPayloadShape";
import {
  DEFAULT_MONITOR_BAUD,
  MONITOR_BAUD_CHOICES,
  MONITOR_NO_PORT_CODE,
  MONITOR_PORTS_SHAPE,
  narrowSerialPorts,
  type SerialPortChoice,
} from "@alp-sdk/core/monitor/ports";
import * as vscode from "vscode";

import { hasIssueCode } from "./alpCli/service";
import { runAlpCommand, runAlpInTerminal } from "./alpCli/vscodeAdapter";
import {
  planCliOutcome,
  planFailure,
  planPrecondition,
} from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
import { westCwd } from "./west";

/**
 * The terminal name for a monitor session, keyed on the PORT.
 *
 * `runInTerminal` (`src/util.ts`) does not reuse a pane — it REFUSES a second
 * run under a name that is still active, with "… is still running — wait for
 * it to finish". That refusal is keyed on the name and nothing else, so the
 * name decides what may run at once.
 *
 * Per-port is the only correct key. A fixed "Alp Monitor" would be right about
 * one thing (two readers on ONE serial device is a race over the bytes, not
 * two views of them) and wrong about the case this feature exists for: the
 * AEN801 has TWO consoles — the app console on UART5 and the SE-UART, a
 * different device at a different rate — and a single name makes watching both
 * at once impossible. Keyed on the port, the same port is still refused and
 * two ports open two terminals.
 */
export function monitorRunName(port: string): string {
  return `Alp Monitor — ${port}`;
}

/**
 * Ask tan which serial ports exist.
 *
 * Returns the narrowed list, or `null` when the question could not be asked —
 * in which case the user has already been told why.
 */
async function listSerialPorts(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<SerialPortChoice[] | null> {
  const { outcome } = await runAlpCommand(
    context,
    ["monitor", "--format", "json"],
    cwd,
  );
  const envelope = outcome.envelope;

  // The refusal we came for. Anything else — the binary missing, a parse
  // error, a tan that grew a default port — is a real failure and is reported
  // as one rather than silently producing an empty picker.
  if (!hasIssueCode(envelope, MONITOR_NO_PORT_CODE)) {
    await notify(
      planCliOutcome(outcome, {
        operation: "list the serial ports",
        dedupeKey: "monitor-list-ports",
      }),
    );
    return null;
  }

  // The payload is read through the same shape check every other tan payload
  // goes through, so a renamed field becomes a sentence naming it instead of a
  // picker with nothing in it.
  const shapeError = checkTanPayload(
    envelope?.data,
    MONITOR_PORTS_SHAPE,
    "monitor",
  );
  if (shapeError) {
    await notify(
      planFailure({
        operation: "List serial ports",
        cause: shapeError,
        dedupeKey: "monitor-payload-shape",
      }),
    );
    return null;
  }

  const data = envelope?.data as { availablePorts?: unknown };
  return narrowSerialPorts(data.availablePorts);
}

/** Let the user choose a port. Never preselects. */
async function pickPort(
  ports: readonly SerialPortChoice[],
): Promise<string | null> {
  const items = ports.map((port) => ({
    label: port.device,
    // tan's own word, verbatim — including its literal "n/a". Suppressing a
    // value tan chose to send would be this repo second-guessing the only
    // source it has for what a port is.
    description: port.description ?? "",
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: "Alp: Choose the serial port to monitor",
    placeHolder:
      "Pick the board's console. Not every port is a board — a power " +
      "supply and Bluetooth audio devices enumerate here too.",
    ignoreFocusOut: true,
  });
  return pick?.label ?? null;
}

/** Let the user choose a baud rate, preselecting tan's default. */
async function pickBaud(): Promise<number | null> {
  const items = MONITOR_BAUD_CHOICES.map((choice) => ({
    label: String(choice.baud),
    description: choice.note ?? "",
    baud: choice.baud,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: "Alp: Choose the baud rate",
    placeHolder:
      `Default ${DEFAULT_MONITOR_BAUD}. A console read at the wrong rate ` +
      "prints nothing at all, which looks like a board that never booted.",
    ignoreFocusOut: true,
  });
  return pick?.baud ?? null;
}

export function registerMonitorCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.openSerialMonitor", () =>
      openSerialMonitor(context),
    ),
  ];
}

/** `Alp: Open serial monitor`. */
export async function openSerialMonitor(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Its OWN guard, the same reasoning `westRunNativeSim` carries: this command
  // never calls `resolveOrchestratorTarget`, so without this it would spawn
  // `tan` against an inherited cwd.
  const cwd = westCwd();
  if (!cwd) {
    await notify(
      planPrecondition("noWorkspace", { operation: "open a serial monitor" }),
    );
    return;
  }

  const ports = await listSerialPorts(context, cwd);
  if (ports === null) return;

  if (ports.length === 0) {
    // The honest end of the "a non-hardware target does not offer this"
    // acceptance item: this extension has no notion of a currently-selected
    // target, so it cannot know a native_sim session is in progress. What it
    // CAN say is what tan measured — that there is nothing to connect to.
    await notify(
      planFailure({
        operation: "Open serial monitor",
        cause: "No serial ports were found.",
        detail:
          "`tan monitor` enumerated no devices. Connect the board's USB " +
          "console and try again. A native_sim run is a host binary with no " +
          "serial device — use the Run action's terminal for its output.",
        severity: "warning",
        dedupeKey: "monitor-no-ports",
      }),
    );
    return;
  }

  const port = await pickPort(ports);
  if (!port) return;

  const baud = await pickBaud();
  if (baud === null) return;

  // Literal argv on purpose. `test/tan.surfaceContract.test.js` reduces a
  // leading-literal array and checks every flag against the pinned surface;
  // hiding this behind a builder would move it into EXPECTED_UNRESOLVABLE and
  // cost the check. Only the VALUES vary, which the extractor handles as
  // metavars — the same shape as the wizard's `["explain", "--template", id]`.
  //
  // `--baud` is sent explicitly even at tan's default: a default that moves
  // upstream should change what tan does, not silently change what the user
  // believes they picked.
  await runAlpInTerminal(
    context,
    ["monitor", "--port", port, "--baud", String(baud)],
    { name: monitorRunName(port), cwd },
  );
}
