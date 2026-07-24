import type { ReactNode } from "react";
import styles from "./Button.module.css";

interface Props {
  children: ReactNode;
  appearance?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  onClick?: () => void;
}

export function Button({
  children,
  appearance = "primary",
  disabled,
  loading,
  title,
  onClick,
}: Props) {
  return (
    <button
      className={styles.btn}
      data-appearance={appearance}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={title}
      onClick={onClick}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
