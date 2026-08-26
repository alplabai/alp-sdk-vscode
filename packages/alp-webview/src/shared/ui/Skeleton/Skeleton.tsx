import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  /** Render a multi-line text placeholder block */
  lines?: number;
}

export function Skeleton({ width, height, radius, lines }: SkeletonProps) {
  if (lines) {
    return (
      <div className={styles.block} role="status" aria-label="Loading…">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={styles.line}
            style={{ width: i === lines - 1 ? "65%" : "100%" }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-label="Loading…"
      // `.skeleton` carries `min-height: 16px` for the no-height case, which
      // would otherwise silently floor an explicit smaller height — a caller
      // asking for 12px got 16px and quietly lost the geometry it was matching.
      style={{ width, height, minHeight: height, borderRadius: radius }}
    />
  );
}
