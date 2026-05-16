import type { ReactNode } from "react";
import { postMessage } from "../vscode";
import styles from "./ResourceLink.module.css";

interface Props {
  /** Target URL — must be https:// or vscode://. */
  href: string;
  /** Accessible label and telemetry identifier. */
  label: string;
  /** Optional leading text/icon rendered before the label. */
  prefix?: string;
  /** Override display content; falls back to `label`. */
  children?: ReactNode;
}

/**
 * An accessible external link that routes through the extension so that
 * `vscode.env.openExternal` handles the OS default browser, and the label
 * is available for telemetry tracking.
 *
 * Keyboard users can activate with Enter or Space as on any <a> element.
 */
export function ResourceLink({ href, label, prefix, children }: Props) {
  const open = () => postMessage({ type: "openUrl", url: href, label });

  return (
    <a
      href={href}
      className={styles.link}
      aria-label={label}
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {prefix && (
        <span className={styles.prefix} aria-hidden="true">
          {prefix}
        </span>
      )}
      {children ?? label}
    </a>
  );
}
