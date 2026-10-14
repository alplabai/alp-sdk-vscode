// SPDX-License-Identifier: Apache-2.0
//
// The toast a finished `tan flash` raises (#540). The CLASSIFICATION is pure
// and lives in `@alp-sdk/core/flash/outcome`; this file only maps its words
// onto the notification planners, so the mapping is assertable without a VS
// Code host.
//
// A flash does not go through the generic "<name> finished." / "<name>
// failed." subscriber in `src/extension.ts`: that one has the exit status and
// nothing else, and at tan 0.7.0 the exit status cannot say whether a device
// was written (every entry planned exits 1, a mixed run exits 0). The runner
// reports the finish with no exit code for a flash it read an envelope from,
// which that subscriber treats as "no verdict to report", and raises this plan
// instead.

import {
  classifyFlashOutcome,
  describeFlashOutcome,
  type FlashOutcomeText,
} from "@alp-sdk/core/flash/outcome";
import { parseFlashEnvelope } from "@alp-sdk/core/flash/envelope";

import type { NotificationPlan } from "../notify/models";
import { planFailure, planSuccess } from "../notify/service";

/** The words for a finished run, from its stdout. Null stdout or non-JSON
 *  stdout is the "unknown" outcome, never a guess. */
export function flashOutcomeText(stdout: string): FlashOutcomeText {
  return describeFlashOutcome(classifyFlashOutcome(parseFlashEnvelope(stdout)));
}

/**
 * The notification for a finished flash. A preview or a clean write is info; a
 * partial write is an error; everything else is a warning — and none of them
 * says "failed" about a run that wrote nothing.
 */
export function planFlashOutcome(
  operation: string,
  text: FlashOutcomeText,
): NotificationPlan {
  if (text.severity === "info") {
    return planSuccess(text.message, {
      detail: text.detail,
      actions: [{ id: "showOutput" }],
    });
  }
  return planFailure({
    severity: text.severity,
    operation,
    cause: text.message,
    detail: text.detail,
    actions: [{ id: "showOutput" }, { id: "runDoctor" }],
  });
}
