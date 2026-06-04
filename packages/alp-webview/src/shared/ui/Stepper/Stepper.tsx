import type { ReactNode } from "react";
import type { StepState } from "../../hooks/useStepper";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Spinner } from "../Spinner";
import styles from "./Stepper.module.css";

// ---------------------------------------------------------------------------
// Stepper — visual step indicator
// ---------------------------------------------------------------------------

export interface StepperProps {
  steps: StepState[];
  direction?: "horizontal" | "vertical";
}

export function Stepper({ steps, direction = "vertical" }: StepperProps) {
  const items: ReactNode[] = [];

  steps.forEach((step, i) => {
    if (i > 0) {
      items.push(
        <div
          key={`conn-${step.id}`}
          className={styles.connector}
          data-complete={steps[i - 1].status === "complete" ? "" : undefined}
          aria-hidden="true"
        />,
      );
    }
    items.push(
      <div
        key={step.id}
        className={styles.step}
        role="listitem"
        data-status={step.status}
        aria-current={step.status === "active" ? "step" : undefined}
      >
        <div className={styles.dot} aria-hidden="true">
          {step.status === "complete" ? (
            <Icon name="check" size={12} />
          ) : step.status === "error" ? (
            <Icon name="warning" size={12} />
          ) : (
            i + 1
          )}
        </div>
        <span className={styles.title}>{step.title}</span>
      </div>,
    );
  });

  return (
    <div
      className={styles.stepper}
      data-direction={direction}
      role="list"
      aria-label="Progress"
    >
      {items}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepperNav — back / next / cancel navigation bar
// ---------------------------------------------------------------------------

export interface StepperNavProps {
  isFirst: boolean;
  isLast: boolean;
  loading?: boolean;
  disabled?: boolean;
  nextLabel?: string;
  finishLabel?: string;
  onBack: () => void;
  onNext: () => void;
  onCancel?: () => void;
}

export function StepperNav({
  isFirst,
  isLast,
  loading = false,
  disabled = false,
  nextLabel = "Next",
  finishLabel = "Finish",
  onBack,
  onNext,
  onCancel,
}: StepperNavProps) {
  return (
    <div className={styles.nav}>
      {onCancel && (
        <Button appearance="secondary" disabled={loading} onClick={onCancel}>
          Cancel
        </Button>
      )}
      <div className={styles.navEnd}>
        <Button
          appearance="secondary"
          disabled={isFirst || loading}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          appearance="primary"
          disabled={disabled || loading}
          onClick={onNext}
        >
          {loading ? <Spinner /> : isLast ? finishLabel : nextLabel}
        </Button>
      </div>
    </div>
  );
}
