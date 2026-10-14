// SPDX-License-Identifier: Apache-2.0
//
// The "Plan" section: what `tan build --plan` would run per slice, with the
// generated config artefacts one disclosure down. At the pinned tan the plan
// is never available (tan-cli#427 retired the flag), so this renders only
// when a plan arrives; the panel's main surface is the manifest below it.

import { Fragment, useId, useState } from "react";
import { Icon } from "../../shared/ui";
import type {
  BuildPlanData,
  BuildPlanGeneratedFile,
  BuildPlanSlice,
  BuildPlanWarning,
} from "../../types";
import styles from "./rows.module.css";

function commandLine(slice: BuildPlanSlice): string | null {
  if (!slice.command) return null;
  const { tool, args } = slice.command;
  return args.length > 0 ? `${tool} ${args.join(" ")}` : tool;
}

/** A generated file: its path, and its contents one disclosure down. */
function FileRow({ file }: { file: BuildPlanGeneratedFile }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <div className={styles.lead}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${file.path}`}
            onClick={() => setOpen((cur) => !cur)}
          >
            <span className={styles.toggleIcon} data-open={open || undefined}>
              <Icon name="chevronRight" size={12} />
            </span>
          </button>
          <span className={styles.name}>{file.path}</span>
        </div>
      </div>
      {open && (
        <pre className={styles.quote} data-kind="plain">
          {file.contents}
        </pre>
      )}
    </li>
  );
}

function Warning({ warning }: { warning: BuildPlanWarning }) {
  return (
    <p className={styles.problem} data-kind="warn">
      <Icon name="warning" size={14} className={styles.problemIcon} />
      <span>
        {warning.code} — {warning.message}
      </span>
    </p>
  );
}

function SliceRow({
  slice,
  warnings,
}: {
  slice: BuildPlanSlice;
  warnings: BuildPlanWarning[];
}) {
  const [open, setOpen] = useState(false);
  const command = commandLine(slice);
  const env = Object.entries(slice.env);
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <div className={styles.lead}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${slice.coreId} plan details`}
            onClick={() => setOpen((cur) => !cur)}
          >
            <span className={styles.toggleIcon} data-open={open || undefined}>
              <Icon name="chevronRight" size={12} />
            </span>
          </button>
          <div className={styles.ident}>
            <span className={styles.name}>{slice.coreId}</span>
            <span className={styles.sub}>{slice.backend}</span>
          </div>
        </div>
        <div className={styles.body}>
          {command ? (
            <span className={styles.name}>{command}</span>
          ) : (
            <p className={styles.problem} data-kind="warn">
              <Icon name="warning" size={14} className={styles.problemIcon} />
              <span>No command yet — this slice is not buildable.</span>
            </p>
          )}
          {warnings.map((w, i) => (
            <Warning key={`${w.code}:${i}`} warning={w} />
          ))}
        </div>
      </div>
      {open && (
        <>
          <dl className={styles.details}>
            <dt>Build dir</dt>
            <dd>{slice.buildDir}</dd>
            {env.map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          {slice.configArtefacts.length > 0 && (
            <ul className={styles.list}>
              {slice.configArtefacts.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function PlanRows({ plan }: { plan: BuildPlanData }) {
  const headingId = useId();
  const general = plan.warnings.filter((w) => !w.coreId);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          Plan
        </h2>
        <span className={styles.sectionNote}>
          {plan.slices.length} slice{plan.slices.length === 1 ? "" : "s"} ·{" "}
          <span className={styles.name}>{plan.boardYaml}</span>
        </span>
      </div>
      {general.map((w, i) => (
        <Warning key={`${w.code}:${i}`} warning={w} />
      ))}
      <ul className={styles.list}>
        {plan.slices.map((slice) => (
          <SliceRow
            key={slice.coreId}
            slice={slice}
            warnings={plan.warnings.filter((w) => w.coreId === slice.coreId)}
          />
        ))}
      </ul>
      {plan.sharedArtefacts.length > 0 && (
        <>
          <div className={styles.sectionHead}>
            <span className={styles.sectionNote}>Shared artefacts</span>
          </div>
          <ul className={styles.list}>
            {plan.sharedArtefacts.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
