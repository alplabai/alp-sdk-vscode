// SPDX-License-Identifier: Apache-2.0
//
// The "Interconnect" section: one row per IPC link. A blocked link says so
// on its own row, with the resolver's reason — whole, verbatim — one
// disclosure down, and the one action that can fix it (open the board
// config) beside it. A resolved link names where its carve-out landed.

import { useId, useState } from "react";
import type { ManifestIpcLink, MemorySpan } from "../../types";
import {
  BOARD_CONFIG_LABEL,
  copyFindingText,
  openDeclaringFile,
} from "./blockedFindingActions";
import { formatRange } from "./format";
import { endOf } from "./regionWindow";
import styles from "./rows.module.css";

type Kind = "ok" | "warn" | "err";

/** No status is what "resolved" looks like in this contract. */
const kindOf = (status: string | undefined): Kind =>
  !status || status === "ok" ? "ok" : status === "blocked" ? "err" : "warn";

/** Where a resolved link's carve-out landed, from the memory view — the
 *  same span the strip draws, so the two never disagree on an address. */
function placedText(link: ManifestIpcLink, spans: MemorySpan[]): string | null {
  const span = spans.find((s) => s.id === `carve_out:${link.name}`);
  if (!span || span.base === null) return null;
  const end = endOf(span);
  const where =
    end !== null
      ? formatRange(span.base, end)
      : formatRange(span.base, span.base);
  return span.region ? `${where} in ${span.region}` : where;
}

function Row({ link, spans }: { link: ManifestIpcLink; spans: MemorySpan[] }) {
  const [open, setOpen] = useState(false);
  const kind = kindOf(link.status);
  const placed = placedText(link, spans);
  const statusWord = link.status ?? (placed ? "placed" : "ok");
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <div className={styles.lead}>
          <span
            className={styles.dot}
            data-kind={kind}
            role="img"
            aria-label={statusWord}
            title={statusWord}
          />
          <div className={styles.ident}>
            <span className={styles.name}>{link.name}</span>
            <span className={styles.sub}>
              {link.kind} · {link.endpoints.join(" ↔ ")}
            </span>
          </div>
        </div>
        <div className={styles.body}>
          <span className={styles.status} data-kind={kind}>
            {statusWord}
            {placed && (
              <>
                {" · "}
                <span className={styles.name}>{placed}</span>
              </>
            )}
          </span>
        </div>
        {(link.reason || kind === "err") && (
          <div className={styles.actions}>
            {link.reason && (
              <button
                type="button"
                className={styles.linkBtn}
                aria-expanded={open}
                onClick={() => setOpen((cur) => !cur)}
              >
                {open ? "Hide reason" : "Show reason"}
              </button>
            )}
            {kind === "err" && (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={openDeclaringFile}
              >
                Open {BOARD_CONFIG_LABEL}
              </button>
            )}
          </div>
        )}
      </div>
      {open && link.reason && (
        <>
          <pre className={styles.quote} data-kind={kind}>
            {link.reason}
          </pre>
          <div className={styles.quoteActions}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => copyFindingText(link.reason as string)}
            >
              Copy reason
            </button>
          </div>
        </>
      )}
    </li>
  );
}

export function InterconnectRows({
  links,
  spans,
}: {
  links: ManifestIpcLink[];
  spans: MemorySpan[];
}) {
  const headingId = useId();
  const blocked = links.filter((l) => kindOf(l.status) === "err").length;
  const degraded = links.filter((l) => kindOf(l.status) === "warn").length;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          Interconnect
        </h2>
        {blocked > 0 && (
          <span className={styles.sectionNote} data-kind="err">
            {blocked} blocked
          </span>
        )}
        {degraded > 0 && (
          <span className={styles.sectionNote} data-kind="warn">
            {degraded} not ok
          </span>
        )}
        {blocked === 0 && degraded === 0 && (
          <span className={styles.sectionNote}>all ok</span>
        )}
      </div>
      <ul className={styles.list}>
        {links.map((link) => (
          <Row key={link.name} link={link} spans={spans} />
        ))}
      </ul>
    </section>
  );
}
