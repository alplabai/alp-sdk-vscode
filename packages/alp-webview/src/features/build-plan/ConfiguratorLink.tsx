// SPDX-License-Identifier: Apache-2.0
//
// "Edit in Configurator" for one IPC link or storage partition (#484).
//
// The Build Plan never edits board config itself. This link opens the Board
// Configurator — the extension's one writer of that file — at the entry,
// with its size field focused; the reader changes the value there. What the
// row beside it shows is the LAST build's request and tan's verdict on it,
// so when the manifest is not known to describe the last build the link
// says so, and in every case a changed value is only judged by tan on the
// next build.

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

/** Said beside the link whenever the shown verdict may not be current. */
export const LAST_BUILD_NOTE =
  "from the last build — rebuild after editing to see tan's verdict";

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
      {!fresh && <span className={styles.sub}>{LAST_BUILD_NOTE}</span>}
    </span>
  );
}
