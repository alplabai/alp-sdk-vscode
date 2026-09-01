// SPDX-License-Identifier: Apache-2.0
//
// Which tan version a given SoM needs before its build can even be configured
// (#502).
//
// This is a FEATURE GATE, not a pin: it compares against the version actually
// running, exactly as `RENODE_CORE_CLI_VERSION` (src/west.ts) does, and for the
// same reason. `SUPPORTED_CLI_VERSION` only governs the binary this extension
// downloads and manages; `alpSdk.cliPath` and a tan already on PATH are neither
// chosen nor upgraded by us, so a pin bump alone leaves those customers on the
// broken combination with no explanation on screen.

import { E1M_MODULES } from "../ideHub/projectScaffold";
import { isCliBehind } from "./service";

/**
 * The first tan release whose vendored planner can configure a Renesas SoM.
 *
 * Older tans emit `CONFIG_ALP_SDK_CHIP_NONE=y` into the generated Kconfig
 * fragment. alp-sdk v0.15.0 (2026-08-07) carries the driver-status fix that
 * removed that symbol, so Zephyr refuses the assignment and aborts the
 * configure step -- the board, the toolchain and the devicetree all resolve
 * first, which is why the failure reads as a project problem rather than a
 * version one.
 *
 * `0.6.0-rc1` was MEASURED, not read off the release notes, which do not
 * mention this fix at all: tan-cli#688 (`6901280`) is the fix commit, and
 * `6901280...v0.6.0-rc1` compares 45 ahead / 0 behind while `6901280...v0.5.1`
 * is diverged. tan-cli#639 is the upstream issue.
 *
 * It is deliberately a SEPARATE constant from `SUPPORTED_CLI_VERSION` even
 * though the two are equal today, because they answer different questions and
 * move for different reasons: the pin moves to `0.6.0` the moment that tag is
 * cut, while this floor stays at `0.6.0-rc1` forever -- rc1 really is the
 * oldest tan that works, and raising the floor alongside the pin would start
 * warning customers whose CLI is fine.
 * `test/alpCli.somCliFloor.test.js` gates that the pin never falls below it.
 */
export const RENESAS_BUILD_CLI_VERSION = "0.6.0-rc1";

/** The `E1M_MODULES` family prefix covering both Renesas lines -- plain
 *  `renesas-rzv2n` and the DEEPX variant `renesas-rzv2n-deepx`. Matching the
 *  FAMILY rather than listing SKUs means a Renesas module added to the catalog
 *  later is covered on the day it lands; the companion test asserts the derived
 *  set still equals the four SKUs #502 actually measured, so a new one reds
 *  rather than silently inheriting a claim nobody checked. */
const RENESAS_FAMILY_PREFIX = "renesas-";

/**
 * Whether `sku` names a Renesas module in the New Project catalog.
 *
 * Exact id match, never a substring: `board.yaml`'s `som.sku` is free text as
 * far as this module is concerned, and a `startsWith`/`includes` test would
 * claim a future `E1M-V2N1010` this file knows nothing about.
 */
export function isRenesasSku(sku: string): boolean {
  return E1M_MODULES.some(
    (module) =>
      module.id === sku && module.family.startsWith(RENESAS_FAMILY_PREFIX),
  );
}

/** A split warning: `cause` is the one line worth a toast, `detail` carries the
 *  verbatim Kconfig text into the output channel. Split rather than one string
 *  because `planFailure` only relocates a `cause` it detects as raw output
 *  (`looksRaw` tests errno/exit-code/stack, none of which appear here), so a
 *  single long string would land whole in the toast. */
export interface SomCliFloorWarning {
  readonly cause: string;
  readonly detail: string;
}

/**
 * The warning to show before building `sku` with tan `probedVersion`, or `null`
 * when there is nothing to say.
 *
 * Returns `null` -- stays silent -- for every uncertain case: a non-Renesas or
 * unknown SKU, and an absent or unparseable probe. `probeTanVersion` yields
 * `null` when the managed binary has not been downloaded yet, and `isCliBehind`
 * reports `false` for anything it cannot parse (`cliSkew` returns `"unknown"`),
 * so a first run before any CLI exists produces no noise about a version the
 * customer has not chosen.
 *
 * It warns rather than refuses. The build is the customer's command, the floor
 * is a claim about someone else's binary, and a wrong refusal is worse than a
 * wrong warning -- so this explains the abort they are about to see and then
 * gets out of the way.
 */
export function somCliFloorWarning(
  sku: string,
  probedVersion: string | null,
): SomCliFloorWarning | null {
  if (!isRenesasSku(sku)) return null;
  if (!isCliBehind(probedVersion, RENESAS_BUILD_CLI_VERSION)) return null;

  return {
    cause:
      `tan ${probedVersion} cannot build ${sku} — Renesas modules need tan ` +
      `${RENESAS_BUILD_CLI_VERSION} or newer.`,
    // The Kconfig line is reproduced EXACTLY as Zephyr prints it, so a customer
    // who already hit the abort can match this to what scrolled past. Trimming
    // it to "a Kconfig error" would cost the only string they can search for.
    detail:
      `tan ${probedVersion} generates CONFIG_ALP_SDK_CHIP_NONE=y, a Kconfig ` +
      `symbol current alp-sdk releases no longer define. The board, toolchain ` +
      `and devicetree all resolve first, then Zephyr's configure step aborts: ` +
      `"warning: attempt to assign the value 'y' to the undefined symbol ` +
      `ALP_SDK_CHIP_NONE" followed by "error: Aborting due to Kconfig ` +
      `warnings". Upstream fix: tan-cli#639.`,
  };
}
