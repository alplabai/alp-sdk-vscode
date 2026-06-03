import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
  children: ReactNode;
}

export function Card({
  padding = "md",
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={[styles.card, className].filter(Boolean).join(" ")}
      data-padding={padding}
    >
      {children}
    </div>
  );
}
