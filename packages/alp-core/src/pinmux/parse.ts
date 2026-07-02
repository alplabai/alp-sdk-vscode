// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { PinmuxPad, PinmuxTable } from "./models";

/** Parse a metadata/pinmux/<family>.yaml capability table. Malformed input yields an empty table. */
export function parsePinmuxTable(text: string): PinmuxTable {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch {
    raw = null;
  }

  if (!raw || typeof raw !== "object") {
    return { family: "", displayName: undefined, pads: [] };
  }

  const doc = raw as Record<string, unknown>;
  const family = typeof doc.family === "string" ? doc.family : "";
  const displayName =
    typeof doc.display_name === "string" ? doc.display_name : undefined;

  const pads: PinmuxPad[] = [];
  if (Array.isArray(doc.pads)) {
    for (const entry of doc.pads) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const pad = entry as Record<string, unknown>;
      if (
        typeof pad.e1m_pad !== "string" ||
        typeof pad.e1m_function !== "string"
      ) {
        continue;
      }

      pads.push({
        e1mPad: pad.e1m_pad,
        e1mFunction: pad.e1m_function,
        owner: typeof pad.owner === "string" ? pad.owner : "",
        siliconPeripheral:
          typeof pad.silicon_peripheral === "string"
            ? pad.silicon_peripheral
            : "",
        siliconPad: typeof pad.silicon_pad === "string" ? pad.silicon_pad : "",
      });
    }
  }

  return { family, displayName, pads };
}
