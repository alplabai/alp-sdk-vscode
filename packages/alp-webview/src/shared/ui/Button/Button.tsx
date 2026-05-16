import type { ReactNode } from "react";
import styles from "./Button.module.css";

interface Props {
  children: ReactNode;
  appearance?: "primary" | "secondary";
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}

export function Button({
  children,
  appearance = "primary",
  disabled,
  title,
  onClick,
}: Props) {
  return (
    <button
      className={styles.btn}
      data-appearance={appearance}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
