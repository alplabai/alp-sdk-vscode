// SPDX-License-Identifier: Apache-2.0
//
// The ways `tan init` refuses what the wizard sends it (#530, #582).
//
// The New Project flow offers every template with every SoM, and 12 of the 44
// pairs cannot be scaffolded. Measured against the pinned tan 0.6.0 with
// alp-sdk v0.16.0-rc1:
//
//   minimal-app      ok on all 11 SoMs
//   zephyr-app       ok except E1M-NX9101   -> init.som-unsupported
//   sensor-starter   ok except E1M-NX9101   -> init.som-unsupported
//   iot-starter      ok ONLY on E1M-AEN801  -> init.invalid-som   (10 of 11)
//
// tan is right to refuse both: rendering an Alif or Renesas scaffold tree under
// an NXP SKU would write another vendor's content into the customer's project,
// and `iot-starter`'s Wi-Fi path is silicon-validated on E1M-AEN801 only. What
// was missing is on this side — the customer filled in a name and a
// destination, pressed Create, and got a raw refusal with no route forward.
//
// The two codes need two different sentences. `init.invalid-som` is fixable by
// changing the SoM (the message names the SKU that works); `init.som-unsupported`
// is not — no SoM change helps if the template ships no tree for that family,
// and the way out is a different template or an example. Telling a customer to
// try another SoM in that case sends them round the wizard for nothing.
//
// FILTERING the picker so an impossible pair cannot be chosen would be better
// still, and it is not possible today: per-template SoM support is not machine
// readable. `tan presets` has no template data at all, and `tan explain
// <template>` returns it as English inside `details[]` ("(E1M-AEN801 only)").
// Parsing that is exactly what this module refuses to do, so the picker filter
// waits on an upstream field.

/**
 * Which refusal this is. Deliberately a narrow union: an unrecognised code is
 * `null`, not a third kind, so a refusal this extension has no guidance for
 * keeps tan's own reporting rather than being wrapped in a wrong sentence.
 */
export type InitRefusalKind =
  | "no-scaffold-for-som"
  | "template-pinned-to-som"
  | "core-layout-refused";

export interface InitRefusal {
  kind: InitRefusalKind;
  /** tan's code, verbatim — the thing that was classified. */
  code: string;
  /**
   * tan's own message, verbatim, or `null` when it sent none. DISPLAY ONLY: it
   * names the supported SKU, which no table here could, and it is never parsed.
   */
  message: string | null;
}

/** Code → kind. The whole vocabulary this module understands. */
const KINDS: Readonly<Record<string, InitRefusalKind>> = {
  "init.som-unsupported": "no-scaffold-for-som",
  "init.invalid-som": "template-pinned-to-som",
  // `--cores` named something tan will not accept — in practice, the core it
  // resolves as the plan's app core, spliced in as `:off`. `planInitCores` is
  // built so no answer can produce that (#582): it never emits a
  // declared-zephyr core at all, and the measured refusal count over four
  // answers for every core of all eleven SoMs is 0 of 368.
  //
  // Classified anyway, because that 0 is a MEASUREMENT of one catalog against
  // one pinned CLI, not a contract. A SoM whose app core is declared something
  // other than `zephyr` would put the case back, and nothing in this repo would
  // catch it — an unclassified refusal leaves the customer on a Confirm step
  // whose Create button will fail again, with nothing saying where to go.
  "init.invalid-cores": "core-layout-refused",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Classify a `tan init` failure's issues, or answer `null`.
 *
 * ON THE CODE, NEVER ON THE PROSE — the same rule
 * `features/models/cliSurface.ts` follows. A message is a sentence tan is free
 * to reword; a code is the contract. Matching text would turn a copy-edit
 * upstream into a silently dead branch here.
 *
 * `issues` is typed `unknown` because it arrives from an envelope: it can be
 * absent, null, or not a list at all, and none of those may throw.
 */
export function classifyInitRefusal(issues: unknown): InitRefusal | null {
  if (!Array.isArray(issues)) return null;
  for (const issue of issues) {
    if (!isRecord(issue)) continue;
    const code = issue.code;
    if (typeof code !== "string") continue;
    const kind = KINDS[code];
    if (!kind) continue;
    return {
      kind,
      code,
      message: typeof issue.message === "string" ? issue.message : null,
    };
  }
  return null;
}
