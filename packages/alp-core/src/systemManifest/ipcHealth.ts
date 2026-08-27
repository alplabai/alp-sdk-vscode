// SPDX-License-Identifier: Apache-2.0
//
// Which IPC links a finished build owes the customer a word about, and the
// words for it (#553).
//
// THE DEFECT. `tan init --cores` scaffolds a default `ipc:` channel whenever a
// companion core is named — measured on tan `0.6.0-rc1`: no `--cores` at all
// yields no `ipc:`, `--cores a32_cluster:yocto` yields one, and
// `--cores a32_cluster:off` yields none. On an AEN SoM that channel resolves
// `status: blocked` with a concrete, actionable `reason`, the build reports
// success and exits 0, and nothing anywhere says so. The customer finds out by
// opening `build/system-manifest.yaml`.
//
// It is not a parse gap. `parseSystemManifest` casts the whole `ipc` array
// rather than rebuilding it field by field, so `status` and `reason` already
// reach this extension in structured form; and the Build Plan panel's renderer
// already prints both. What was missing is anything that LOOKS.
//
// Pure, and separate from the `vscode` seam for the same reason
// `flash/describe.ts` is: text only reachable through a toast is text no test
// can read.

import type { ManifestIpcLink } from "./models";

/** Enough of a manifest to answer the question. Deliberately not the whole
 *  `SystemManifest`: this runs against a file that may be older than the code
 *  reading it, and an absent `ipc` block is normal, not an error. */
export interface IpcHealthInput {
  ipc?: readonly ManifestIpcLink[];
}

/** The words for a link whose manifest states no reason. Printed rather than
 *  omitted so a short notice is never mistaken for a complete one. */
const NO_REASON = "(no reason given)";

/**
 * The links worth interrupting a green build for.
 *
 * A link counts when it states a status and that status is not `ok`. Two edges
 * matter and both are deliberate:
 *
 *  - ABSENT status is not a problem. The manifest said nothing; reporting it
 *    would put a warning on every project that merely HAS an IPC block.
 *  - Any non-`ok` value counts, not just `blocked`. This is the same rule the
 *    Build Plan renderer already applies (`link.status && link.status !== "ok"`),
 *    and `degraded` is a real value in the wild. A rule that knew only
 *    `blocked` would let the others past in silence, which is the defect this
 *    module exists to close, one vocabulary word later.
 */
export function unhealthyIpcLinks(manifest: IpcHealthInput): ManifestIpcLink[] {
  return (manifest.ipc ?? []).filter((link) => {
    const status = link.status;
    return typeof status === "string" && status.length > 0 && status !== "ok";
  });
}

/** One link, with everything the reader needs to recognise it: the name the
 *  manifest gave it, its transport, and the cores it joins — the endpoints are
 *  the surprise, because the link tan scaffolds need not join the cores the
 *  customer picked. */
function renderLink(link: ManifestIpcLink): string {
  const head =
    `${link.name} (${link.kind}) ` +
    `[${link.endpoints.join(" ↔ ")}] — ${link.status}`;
  const reason =
    typeof link.reason === "string" && link.reason.length > 0
      ? link.reason
      : NO_REASON;
  return `${head}\n  ${reason}`;
}

/**
 * The notice for a build that succeeded with links that did not resolve.
 *
 * The message says the build SUCCEEDED, because it did. Turning a green build
 * red over a link the customer may not have asked for would be the opposite
 * error to the one being fixed — and on the SoM this was measured against, the
 * link is one tan added on its own.
 *
 * The reason goes in the detail VERBATIM and in full. It is the only
 * actionable half — "memory_map.base is TBD for region 'mram_main' … Add a
 * `memory_map:` block to metadata/e1m_modules/E1M-AEN801.yaml" tells the
 * reader exactly what to do, and a summarised version tells them nothing.
 */
export function describeUnhealthyIpc(links: readonly ManifestIpcLink[]): {
  message: string;
  detail: string;
} {
  const first = links[0];
  const message =
    links.length === 1 && first
      ? `Alp: the build succeeded, but the IPC link ${first.name} is ${first.status}.`
      : `Alp: the build succeeded, but ${links.length} IPC links did not resolve.`;
  return { message, detail: links.map(renderLink).join("\n\n") };
}
