import styles from "./Spinner.module.css";

export function Spinner() {
  return (
    <span
      className={styles.spinner}
      role="status"
      aria-label="Loading"
      aria-busy="true"
    />
  );
}
