// SPDX-License-Identifier: Apache-2.0
//
// Reading what `tan init --preview` answered (#616): the file list the New
// Project wizard's Confirm step shows before Create writes anything.
//
// NARROW, NEVER CAST (#611, #517) — the same rule `wizard/scaffoldPayload.ts`
// follows for `tan scaffold`'s near-identical `fileChanges[]`/`written[]`
// shape, restated here rather than imported from there: `tan init` and `tan
// scaffold` are two different commands with two different envelopes, and
// sharing a narrower would couple their contracts for no reason but a
// coincidence of field names. A payload missing `fileChanges` answers `null`,
// not an empty-looking `[]` — `written ?? []` is exactly the shape that once
// reported "Materialised 0 file(s)" through a SUCCESS toast for a run whose
// output nobody could read (`test/ideHub.materialiseGuard.test.js`). The
// caller (`NewProjectFlowPanel`) treats `null` the same way: a preview that
// could not be read must not render as "this project creates nothing".

/** One file `tan init --preview` says it would write, exactly as tan reports
 *  it. `kind` (`"new"`/`"update"`/…) is kept a plain `string`, not narrowed to
 *  a closed union, for the same reason `ScaffoldFileChange.kind` is: an unseen
 *  word must still be LISTED, never silently dropped. */
export interface InitPreviewFileChange {
  relativePath: string;
  kind: string;
}

/** `tan init --preview`'s `data`, as much of it as this extension uses.
 *
 * Deliberately does NOT carry `sdkPinned` or `written`. Measured on the pinned
 * tan 0.6.0: `data.sdkPinned` is `null` on a `--preview` pass (only the real
 * run resolves and reports it — see `InitArgvInput.preview`'s doc), and
 * `data.written` is always `[]` here by construction, so there is nothing
 * either field could tell a caller of THIS narrower that the caller does not
 * already know from having sent `--preview` itself. */
export interface InitPreviewResult {
  fileChanges: InitPreviewFileChange[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrow `tan init --preview`'s untrusted `data` into `InitPreviewResult`, or
 * `null` when the shape cannot be read.
 *
 * `null` covers three distinct upstream causes this extension cannot tell
 * apart at this call — the spawn failed, tan refused (a bad template/SoM
 * pair), or `data` came back without a `fileChanges` array — and it does not
 * need to: `null` means "show no list, do not block Create", the same verdict
 * for all three (see `NewProjectPreviewDataMessage` in `src/ideHub/messages.ts`).
 */
export function narrowInitPreview(raw: unknown): InitPreviewResult | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.fileChanges)) return null;

  const fileChanges: InitPreviewFileChange[] = [];
  for (const entry of raw.fileChanges) {
    if (!isRecord(entry)) continue;
    if (typeof entry.relativePath !== "string") continue;
    if (typeof entry.kind !== "string") continue;
    fileChanges.push({ relativePath: entry.relativePath, kind: entry.kind });
  }

  return { fileChanges };
}
