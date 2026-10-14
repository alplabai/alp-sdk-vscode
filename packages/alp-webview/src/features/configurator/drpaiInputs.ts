// SPDX-License-Identifier: Apache-2.0
//
// "DRP-AI is enabled but a required input is missing" (#484 review).
//
// Read off a board.yaml this view did not necessarily write, so every field
// is checked for its TYPE before it is used: a v0.16 file carries
// `drpai: { spec: … }` with none of the three inputs, and calling `.trim()`
// on `undefined` there threw and blanked the whole Configurator render.
// Anything that is not a non-blank string (or, for `input_shape`, a
// non-empty array) counts as missing.

import type { ModelEntry } from "../../types";

const isFilled = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

/** True when the DRP-AI compile target is on but an input is missing. */
export function drpaiPathMissing(m: ModelEntry): boolean {
  const d = (m.compile as { drpai?: unknown } | undefined)?.drpai;
  if (typeof d !== "object" || d === null) return false;
  const { input_shape, input_name, images } = d as Record<string, unknown>;
  const shapeFilled = Array.isArray(input_shape)
    ? input_shape.length > 0
    : isFilled(input_shape);
  return !shapeFilled || !isFilled(input_name) || !isFilled(images);
}

/** True when the DeepX compile target is on but its config or calibration
 *  path is missing — the same type-checked rule as above. */
export function deepxPathMissing(m: ModelEntry): boolean {
  const d = (m.compile as { deepx_dxm1?: unknown } | undefined)?.deepx_dxm1;
  if (typeof d !== "object" || d === null) return false;
  const { config, calibration } = d as Record<string, unknown>;
  return !isFilled(config) || !isFilled(calibration);
}
