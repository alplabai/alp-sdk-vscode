// SPDX-License-Identifier: Apache-2.0
//
// The only host round-trip in the Memory tab (#484 Task 7) — deliberately
// kept in its OWN file, outside `test/memoryRegions.readOnly.test.js`'s
// `VIEW_FILES` (`MemoryRegions.tsx`, `MemoryChart.tsx`, `MemoryTable.tsx`,
// `memoryTableRows.ts`, `AuthoritySwatch.tsx`). That gate asserts none of
// those five files' own source text contains `postMessage`, `runCommand` or
// `from "../../vscode"` — the picture and the table stay provably unable to
// ask the host to do anything, because nothing in the emitted contract can
// yet tell a customer-writable band from a Secure-Enclave-owned one (D5),
// and an edit affordance over that ambiguity is a live hazard (see that
// file's header).
//
// The two actions here are not that hazard. Both act on a BLOCKED finding —
// something the allocator already refused to place — and neither writes a
// byte of memory-map data:
//
//  - `openDeclaringFile` opens `board.yaml` in the editor, so the customer
//    can fix the declaration themselves in a real editor, not through this
//    view.
//  - `copyFindingText` copies the finding's own displayed text to the
//    clipboard.
//
// Both go through the host (`vscode.window.showTextDocument` /
// `vscode.env.clipboard.writeText`) because a raw `vscode://file` href is
// not reliable under the webview CSP.
import { postMessage } from "../../vscode";

/**
 * The one file every `MemoryUnresolved` finding names an entry in.
 *
 * IPC carve-outs (`ipc:`) and storage partitions (`storage:`) are both
 * board.yaml root keys (`@alp-sdk/core`'s `BoardConfig`), and slot images
 * come from a core's `app`/`image`, declared there too. `MemoryUnresolved`
 * itself carries no per-finding path — there is exactly one file to open,
 * never a field this module would otherwise have to invent.
 */
export const DECLARING_FILE = "board.yaml";

/** Ask the host to open `board.yaml` in the editor. */
export function openDeclaringFile(): void {
  postMessage({ type: "openWorkspaceFile", path: DECLARING_FILE });
}

/** Ask the host to put `text` on the system clipboard. */
export function copyFindingText(text: string): void {
  postMessage({ type: "copyText", text });
}
