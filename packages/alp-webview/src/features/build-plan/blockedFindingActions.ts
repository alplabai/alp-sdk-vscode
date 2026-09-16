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
// THIS FILE IS IN ITS SCOPE TOO (fix round 1, finding 3) — the gate bans the
// host TRANSPORT itself, not just mutation, so relocating the two calls out
// of the five files above closes nothing on its own. The gate instead names
// this file explicitly and allows exactly the two message types below
// (`openBoardYaml`, `copyText`) and nothing else — no dispatched command,
// no third message type. That allowance is the coordinator's ruling on the
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
 * The label this feature always shows for the "Open" action.
 *
 * IPC carve-outs (`ipc:`) and storage partitions (`storage:`) — the only two
 * kinds `MemoryUnresolved` ever carries (`slotSpans()` in
 * `@alp-sdk/core/systemManifest/memoryView` returns spans only; a slot image
 * can never be a blocked finding) — are both board.yaml root keys
 * (`@alp-sdk/core`'s `BoardConfig`). There is exactly one file to open,
 * never a field this module would otherwise have to invent — but it is a
 * DISPLAY label only. The actual file opened is resolved by the host
 * (`OpenBoardYamlMessage`, `BuildPlanPanel.openBoardYaml`), which honours a
 * custom or absolute `alpSdk.boardYamlPath` and a multi-root workspace; this
 * constant never reaches the wire.
 */
export const DECLARING_FILE = "board.yaml";

/** Ask the host to open the project's board.yaml — wherever the host itself
 *  resolves it to be, never a path this module guesses. */
export function openDeclaringFile(): void {
  postMessage({ type: "openBoardYaml" });
}

/** Ask the host to put `text` on the system clipboard. */
export function copyFindingText(text: string): void {
  postMessage({ type: "copyText", text });
}
