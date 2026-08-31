// SPDX-License-Identifier: Apache-2.0
//
// What to do when `tan sdk current` and `alpSdk.path` disagree after a
// bootstrap (#604).
//
// ── The symptom ─────────────────────────────────────────────────────────────
//
// `tan bootstrap` MOVES the customer's alp-sdk checkout. Not as a corner case:
// measured on the pinned tan 0.6.0, a plain `tan bootstrap` with no
// `--workspace` at all relocates the checkout to
// `<parent>/alp-workspace/<name>` and writes `~/.alp/sdk-default` pointing
// there. `alpSdk.path` then names a directory that no longer exists, every
// `--sdk-root` this extension sends points at nothing, and until now the only
// trace was a line in an output channel nobody had open.
//
// ── Why this is not "read the code off the envelope" ────────────────────────
//
// #604 suggests reading `bootstrap.workspace-relocated` off the bootstrap
// envelope. Measured, that cannot work on the path that matters:
//
//   The REAL bootstrap has no envelope. It runs through `runAlpInTerminal`
//   (`src/bootstrap.ts`, `src/toolchain.ts`), which parses nothing at all.
//
//   The one envelope carrying the code is the win32 `--dry-run` pre-flight —
//   and there `data.sdkRoot` is the PLANNED destination, which does not exist
//   yet (verified: the dry-run moved nothing, and its message reads "would
//   move" where the real run reads "moved"). Re-pointing the pin at it would
//   CREATE the dangling pin this file exists to detect.
//
// So the signal is not in the envelope. It is on disk: a relocation leaves the
// old path gone, and that is what `pinExists` reports.
//
// ── Why this asks instead of writing ────────────────────────────────────────
//
// Adversarial review of #614 established that this comparison cannot tell a
// genuine relocation from ordinary disagreement — an unmounted external
// volume, a not-yet-cloned SDK, or another project's `globalDefault` all look
// alike — and concluded that a non-empty pin must never be silently
// overwritten. That conclusion stands and is not weakened here.
//
// What changes is the ALTERNATIVE to overwriting. It was silence; it is now a
// question. Asking is safe in every case that ruled out writing: on an
// unmounted volume the customer says no and keeps their pin, which is exactly
// right, and they learn why their builds stopped resolving either way.

/** `tan sdk current`'s answer, as much of it as this decision needs. */
export interface SdkPinInput {
  /** `alpSdk.path`, already trimmed. Empty string means unpinned. */
  configuredPath: string;
  /** What tan resolved, or `null` when it answered nothing usable. */
  current: {
    sdkPath: string | null;
    readiness: { state: string } | null;
    sourceTier: string;
  } | null;
  /**
   * Does `configuredPath` exist on disk RIGHT NOW?
   *
   * Injected rather than probed so this stays free of `fs`. Meaningless when
   * `configuredPath` is empty, and never read in that case.
   */
  pinExists: boolean;
}

/** What the caller should do. Every arm names the paths involved so the caller
 *  never has to re-derive them, and so a test can assert on a value rather
 *  than on a rendered sentence. */
export type SdkPinReconciliation =
  /** tan answered nothing this extension can act on. Do nothing. */
  | { kind: "no-answer" }
  /** tan resolved a path it also says is not a ready SDK root. Log, act not. */
  | { kind: "not-ready"; sdkPath: string; sourceTier: string }
  /** The pin already names what tan resolved. Nothing to reconcile. */
  | { kind: "agrees"; sdkPath: string }
  /** Nothing pinned. Fill it in — there is nothing to destroy. */
  | { kind: "pin-empty"; sdkPath: string; sourceTier: string }
  /**
   * The pinned path is GONE from disk and tan resolved a ready SDK elsewhere.
   * The relocation case. ASK the customer; never write unasked.
   */
  | {
      kind: "pin-dangling";
      configuredPath: string;
      sdkPath: string;
      sourceTier: string;
    }
  /**
   * The pin exists and tan resolved something else. Ordinary disagreement —
   * two real SDKs, and the customer's choice wins. Log only.
   */
  | {
      kind: "pin-differs";
      configuredPath: string;
      sdkPath: string;
      sourceTier: string;
    };

/**
 * Decide what a post-bootstrap reconciliation should do.
 *
 * The ORDER of the tests is the contract:
 *
 *  1. No usable answer beats everything — there is nothing to compare against.
 *  2. `readiness.state === "missing"` beats agreement: tan resolved a path and
 *     says it is not an SDK root, and acting on that from an unattended
 *     background check would pop an unrelated "not an Alp SDK root" dialog out
 *     of a run the customer never asked this question of.
 *  3. Agreement beats the pin tests, so a pin that matches produces no dialog
 *     even if the path is momentarily unreadable.
 *  4. Empty pin before dangling pin, because an empty pin cannot dangle.
 */
export function classifySdkPin(input: SdkPinInput): SdkPinReconciliation {
  const sdkPath = input.current?.sdkPath;
  if (!sdkPath) return { kind: "no-answer" };
  const sourceTier = input.current?.sourceTier ?? "";

  if (input.current?.readiness?.state === "missing") {
    return { kind: "not-ready", sdkPath, sourceTier };
  }

  const configuredPath = input.configuredPath;
  if (configuredPath === sdkPath) return { kind: "agrees", sdkPath };

  if (!configuredPath) return { kind: "pin-empty", sdkPath, sourceTier };

  if (!input.pinExists) {
    return { kind: "pin-dangling", configuredPath, sdkPath, sourceTier };
  }

  return { kind: "pin-differs", configuredPath, sdkPath, sourceTier };
}

/**
 * The question put to the customer when the pin dangles.
 *
 * Says what is observably true — the pinned directory is not there, tan
 * resolves this one — and does NOT claim the bootstrap moved it. It usually
 * did (that is what `tan bootstrap` does by default), but "the pin does not
 * exist" is the evidence in hand and an unmounted volume produces the same
 * evidence. Claiming the cause would be wrong exactly when the customer most
 * needs to recognise their own situation and say no.
 *
 * Both paths are in the MODAL BODY rather than this sentence: `planFailure`
 * demotes any customer-facing sentence carrying an absolute path into the
 * channel-only `detail` and replaces it with a bare "<operation> failed.",
 * which would throw the question away entirely.
 */
export const PIN_DANGLING_MESSAGE =
  "Alp: the SDK folder pinned in alpSdk.path is no longer there, so builds cannot resolve it. Point Alp at the SDK the tan CLI now resolves?";

/** The modal body: both paths, and what declining means. */
export function describePinDangling(
  configuredPath: string,
  sdkPath: string,
  sourceTier: string,
): string {
  return [
    `Pinned (missing): ${configuredPath}`,
    `tan resolves:     ${sdkPath}`,
    `  (tan sdk current, tier: ${sourceTier})`,
    "",
    "`tan bootstrap` moves the alp-sdk checkout into its west workspace, which",
    "is the usual reason a pin stops resolving. If the pinned folder is only",
    "temporarily unavailable — an unmounted volume, an SDK not cloned yet —",
    "leave the pin alone and it will work again once the folder is back.",
  ].join("\n");
}
