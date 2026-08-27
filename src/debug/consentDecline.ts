// SPDX-License-Identifier: Apache-2.0
//
// One bit, passed from the device-write gate (#586) back to `alp.debug`: the
// customer refused THIS launch.
//
// Both a refusal and a genuine VS Code failure surface identically —
// `vscode.debug.startDebugging` resolves `false` either way, because the
// provider aborts a session by returning `undefined` and VS Code reports that
// as "did not start", not as "was declined". Without this bit `alp.debug`
// follows the gate's "nothing was written to the device" with
// `Alp: VS Code declined to start "<name>" ...`, i.e. two contradictory
// messages for one deliberate decision, the second of which sends the reader
// looking for a fault that is not there.
//
// ZERO IMPORTS, deliberately. `src/debug.ts` is loaded in tests through a
// `Module._load` stub table keyed by request string; anything it reaches that
// pulls in `../notify/vscodeAdapter` drags the real presenter along, and
// `out/util.js` opens an output channel at module scope. A module with no
// imports of its own adds no such edge, which is why the bit lives here rather
// than on the gate that sets it.
//
// ONE-SHOT and name-keyed for the same reason the consent itself is: a bit
// left standing would silence the failure message for the NEXT launch, which
// really did fail.

let declinedConfigName: string | null = null;

/** Record that the customer refused the device write for `configName`. */
export function recordDebugConsentDeclined(configName: string): void {
  declinedConfigName = configName.length > 0 ? configName : null;
}

/**
 * Whether `configName` was refused, clearing the record. False for an unnamed
 * configuration — an empty key would match the next unnamed launch, and
 * swallowing a real failure is the wrong direction to be wrong in.
 */
export function consumeDebugConsentDeclined(configName: string): boolean {
  if (declinedConfigName === null || configName.length === 0) return false;
  if (declinedConfigName !== configName) return false;
  declinedConfigName = null;
  return true;
}
