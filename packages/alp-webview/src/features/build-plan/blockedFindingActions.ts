// SPDX-License-Identifier: Apache-2.0
//
// The only host round-trip in the Memory tab (#484 Task 7) — deliberately
// kept in its OWN file, outside `MemoryRegions.tsx`, `MemoryChart.tsx`,
// `MemoryTable.tsx`, `memoryTableRows.ts` and `AuthoritySwatch.tsx`. Those
// five stay the picture and the table: they never ask the host to do
// anything, because nothing in the emitted contract can yet tell a
// customer-writable band from a Secure-Enclave-owned one (D5), and an edit
// affordance over that ambiguity is a live hazard (see those files' own
// headers).
//
// `test/memoryRegions.readOnly.test.js` is what enforces this split, and
// THIS FILE IS IN ITS SCOPE TOO — the gate bans the host TRANSPORT itself,
// not just mutation, so relocating the two calls out of the five files
// above closes nothing on its own. The gate instead names this file
// explicitly and allows exactly the two message types below
// (`openBoardYaml`, `copyText`) and nothing else — no dispatched command,
// no third message type. That allowance is a deliberate ruling on the
// design (open-file/copy through host messages needs SOME transport)
// balanced against the gate's own intent (no UNAUDITED path back to the
// host); it is not a way around the gate.
//
// Neither action writes memory-map data — both act on a BLOCKED finding,
// something the allocator already refused to place:
//
//  - `openDeclaringFile` opens board.yaml in the editor, so the customer can
//    fix the declaration themselves in a real editor, not through this view.
//  - `copyFindingText` copies the finding's own displayed text to the
//    clipboard.
//
// Both go through the host (`vscode.window.showTextDocument` /
// `vscode.env.clipboard.writeText`) because a raw `vscode://file` href is
// not reliable under the webview CSP.
import { postMessage } from "../../vscode";

/**
 * The label this feature always shows for the "Open" action — deliberately
 * NOT a filename (#484).
 *
 * IPC carve-outs (`ipc:`) and storage partitions (`storage:`) — the only two
 * kinds `MemoryUnresolved` ever carries (`slotSpans()` in
 * `@alp-sdk/core/systemManifest/memoryView` returns spans only; a slot image
 * can never be a blocked finding) — are both board.yaml root keys
 * (`@alp-sdk/core`'s `BoardConfig`). An earlier version of this constant WAS
 * `"board.yaml"`, and the button read "Open board.yaml" — which is a claim
 * about which FILE opens, and the button does not control that: the host
 * resolves `collectProjectContext().boardYamlPath`, which a customer's own
 * `alpSdk.boardYamlPath` setting can legitimately point at
 * `config/custom-board.yml`, or an absolute shared file entirely. The label
 * and the opened file were the same string only by coincidence — true for
 * every project this button had been exercised against, false the moment a
 * real customer configuration diverged.
 *
 * Resolved by NOT NAMING A FILE, rather than by having the host tell the
 * webview what it resolved (the other option available here): this button
 * needs no new host round-trip, no new state field mirrored across
 * `messages.ts`/`types.ts`, and no new way for the label to drift from the
 * file again later — the label simply never claims a fact it cannot verify.
 * "board config" is accurate under every `alpSdk.boardYamlPath` value,
 * including the default.
 */
export const BOARD_CONFIG_LABEL = "board config";

/** Ask the host to open the project's board.yaml — wherever the host itself
 *  resolves it to be, never a path this module guesses. */
export function openDeclaringFile(): void {
  postMessage({ type: "openBoardYaml" });
}

/** Ask the host to put `text` on the system clipboard. */
export function copyFindingText(text: string): void {
  postMessage({ type: "copyText", text });
}
