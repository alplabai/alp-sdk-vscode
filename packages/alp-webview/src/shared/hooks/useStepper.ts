import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "active" | "complete" | "error";

/** Immutable definition of a single step — pass a stable array to useStepper. */
export interface StepDef {
  id: string;
  title: string;
  /** Optional steps can be skipped and are not required to complete the flow. */
  optional?: boolean;
}

/** Runtime state of a single step, derived by useStepper. */
export interface StepState extends StepDef {
  status: StepStatus;
  errorMessage?: string;
}

export interface StepperState {
  steps: StepState[];
  currentIndex: number;
  isFirst: boolean;
  isLast: boolean;
}

export interface UseStepper {
  state: StepperState;
  /** Advance to the next step. Clears any error on the current step. */
  goNext: () => void;
  /** Go back to the previous step. */
  goBack: () => void;
  /** Jump to a specific step index. */
  goTo: (index: number) => void;
  /** Mark the current step as errored with an optional message. */
  markError: (message?: string) => void;
  /** Clear the error on the current step without navigating. */
  clearError: () => void;
  /** Reset to the first step and clear all errors. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Unified stepper state for multi-step wizard flows.
 *
 * `defs` must be a stable reference (defined outside the component or
 * wrapped in useMemo) to avoid unnecessary re-renders.
 */
export function useStepper(defs: StepDef[]): UseStepper {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errorMap, setErrorMap] = useState<Record<number, string>>({});

  const steps = useMemo<StepState[]>(
    () =>
      defs.map((def, i) => {
        const err = errorMap[i];
        let status: StepStatus;
        if (err !== undefined) {
          status = "error";
        } else if (i < currentIndex) {
          status = "complete";
        } else if (i === currentIndex) {
          status = "active";
        } else {
          status = "pending";
        }
        return { ...def, status, errorMessage: err };
      }),
    [defs, currentIndex, errorMap],
  );

  const goNext = useCallback(() => {
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      return next;
    });
    setCurrentIndex((i) => Math.min(i + 1, defs.length - 1));
  }, [currentIndex, defs.length]);

  const goBack = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(index, defs.length - 1)));
    },
    [defs.length],
  );

  const markError = useCallback(
    (message?: string) => {
      setErrorMap((prev) => ({
        ...prev,
        [currentIndex]: message ?? "An error occurred.",
      }));
    },
    [currentIndex],
  );

  const clearError = useCallback(() => {
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      return next;
    });
  }, [currentIndex]);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setErrorMap({});
  }, []);

  return {
    state: {
      steps,
      currentIndex,
      isFirst: currentIndex === 0,
      isLast: currentIndex === defs.length - 1,
    },
    goNext,
    goBack,
    goTo,
    markError,
    clearError,
    reset,
  };
}
