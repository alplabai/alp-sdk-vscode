import { useId, type InputHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({
  label,
  hint,
  error,
  id: externalId,
  className,
  ...inputProps
}: FieldProps) {
  const autoId = useId();
  const id = externalId ?? autoId;
  const descId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(" ")}
      data-error={error ? "" : undefined}
    >
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        className={styles.input}
        aria-describedby={descId}
        aria-invalid={!!error || undefined}
      />
      {error && (
        <span id={descId} role="alert" className={styles.error}>
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={descId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
