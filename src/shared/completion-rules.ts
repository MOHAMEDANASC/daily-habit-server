export interface ProgressRequest {
  /** The habit's measurable target, or null for a plain check-off habit. */
  targetValue: number | null;
  /** Quantity the user logged (omit to leave unspecified). */
  progressValue?: number | null;
  /** Explicit check-off request (omit to infer from the logged quantity). */
  completed?: boolean;
}

export interface ResolvedProgress {
  done: boolean;
  progressValue: number | null;
}

/**
 * Decide whether a day's entry counts as completed.
 *
 *  - Check-off habits are done when the user marks them (default: done).
 *  - Measurable habits are done only when the logged quantity reaches the target;
 *    "mark complete" without a quantity logs exactly the target.
 */
export function resolveProgress({ targetValue, progressValue, completed }: ProgressRequest): ResolvedProgress {
  const measurable = targetValue !== null && targetValue > 0;

  if (!measurable) {
    return { done: completed ?? true, progressValue: progressValue ?? null };
  }

  if (progressValue !== undefined && progressValue !== null) {
    return { done: progressValue >= targetValue, progressValue };
  }
  if (completed === false) return { done: false, progressValue: null };
  return { done: true, progressValue: targetValue };
}

/** Whole-number percentage; 0 when nothing is scheduled. */
export function completionPercentage(completed: number, scheduled: number): number {
  if (scheduled <= 0) return 0;
  return Math.round((Math.min(completed, scheduled) / scheduled) * 100);
}
