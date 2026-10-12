// SPDX-License-Identifier: Apache-2.0
//
// "Edit in Configurator" for one IPC link or storage partition (#484).
//
// The Build Plan never edits board config itself. This link opens the Board
// Configurator — the extension's one writer of that file — at the entry,
// with its size field scrolled to and highlighted (not focused); the reader
// clicks in and changes the value there. What the
// row beside it shows is the last build's request and tan's verdict on it,
// so the link always says a changed value is judged only by the next build,
// and says too when the manifest may not even reflect the last one.

import { openEntryInConfigurator } from "./blockedFindingActions";
import styles from "./rows.module.css";

/** The board-config entry a memory-view id names, or null for anything
 *  that is not one (a slot image, a SoM region). Ids are the core's own
 *  `<kind>:<label>`, and a carve-out's or partition's label IS the entry's
 *  `name`. */
export function configuratorTargetOf(
  id: string,
): { section: "ipc" | "storage"; name: string } | null {
  const split = id.indexOf(":");
  if (split < 0) return null;
  const kind = id.slice(0, split);
  const name = id.slice(split + 1);
  if (name.length === 0) return null;
  if (kind === "carve_out") return { section: "ipc", name };
  if (kind === "partition") return { section: "storage", name };
  return null;
}

/** Said beside the link when the manifest is not known to describe the
 *  last build — the verdict on the row may be older than that. */
export const NOT_FRESH_NOTE =
  "may not reflect the last build — rebuild after editing to see tan's verdict";

/** Said beside the link otherwise: the verdict is the last build's, and an
 *  edit is judged only by the next one. */
export const FRESH_NOTE = "rebuild after editing to see tan's verdict";

export function ConfiguratorLink({
  section,
  name,
  fresh,
}: {
  section: "ipc" | "storage";
  name: string;
  /** True only when the manifest is known to describe the last build. */
  fresh: boolean;
}) {
  return (
    <span className={styles.configLink}>
      <button
        type="button"
        className={styles.linkBtn}
        data-open-in-configurator={`${section}:${name}`}
        title={`Open the Board Configurator at ${section} entry "${name}"`}
        onClick={() => openEntryInConfigurator(section, name)}
      >
        Edit in Configurator
      </button>
      <span className={styles.sub}>{fresh ? FRESH_NOTE : NOT_FRESH_NOTE}</span>
    </span>
  );
}
