import { addDays, eachDay, startOfWeek, type DateString } from "@/shared/dates";
import { scheduledDatesBetween, type ScheduleInfo } from "@/lib/schedule";

/**
 * Streak rules
 * ------------
 *  - Only scheduled occurrences count. Days a habit is not scheduled on (e.g. weekends for a
 *    weekday habit) are skipped: they neither extend nor break a streak.
 *  - A missed scheduled day resets the streak to zero.
 *  - Today never breaks a streak: while today's occurrence is still open the streak shows
 *    the run that ended at the previous scheduled day. Completing it extends the streak.
 *  - WEEKLY habits streak in *weeks*: a week counts when it has at least `weeklyTarget`
 *    completions. The running week never breaks the streak, and the very first (partial)
 *    week is a grace week that is neither counted nor penalised when unmet.
 *  - Completions logged on days outside the schedule add to the totals but not to streaks.
 *  - Archived periods ("pauses") are neutral, exactly like unscheduled days: archiving a habit
 *    and reactivating it later keeps the streak that was running when it was paused.
 */

export interface StreakRun {
  start: DateString;
  end: DateString;
  length: number;
}

export interface StreakResult {
  unit: "day" | "week";
  current: number;
  longest: number;
  currentRun: StreakRun | null;
  longestRun: StreakRun | null;
  /** Most recent runs first (the active one, if any, is first). */
  recentRuns: StreakRun[];
  totalCompletions: number;
  lastCompletedOn: DateString | null;
  /** First date on which a streak of length `n` was reached, for milestone reporting. */
  firstReached: Map<number, DateString>;
}

const MAX_RECENT_RUNS = 5;

export function calculateStreak(
  schedule: ScheduleInfo,
  completedDates: Iterable<DateString>,
  today: DateString,
  weekStartsOn = 1,
): StreakResult {
  const completed = new Set(completedDates);
  const base = {
    totalCompletions: completed.size,
    lastCompletedOn: [...completed].sort().at(-1) ?? null,
  };
  return schedule.scheduleType === "WEEKLY"
    ? { ...base, ...weeklyStreak(schedule, completed, today, weekStartsOn) }
    : { ...base, ...dailyStreak(schedule, completed, today) };
}

type Core = Omit<StreakResult, "totalCompletions" | "lastCompletedOn">;

class RunTracker {
  length = 0;
  start: DateString | null = null;
  end: DateString | null = null;
  readonly closed: StreakRun[] = [];
  readonly firstReached = new Map<number, DateString>();

  extend(date: DateString, reachedOn: DateString = date) {
    if (this.length === 0) this.start = date;
    this.length += 1;
    this.end = date;
    if (!this.firstReached.has(this.length)) this.firstReached.set(this.length, reachedOn);
  }

  reset() {
    if (this.length > 0 && this.start && this.end) {
      this.closed.push({ start: this.start, end: this.end, length: this.length });
    }
    this.length = 0;
    this.start = null;
    this.end = null;
  }

  result(unit: "day" | "week"): Core {
    const currentRun =
      this.length > 0 && this.start && this.end ? { start: this.start, end: this.end, length: this.length } : null;
    const recentRuns = [...(currentRun ? [currentRun] : []), ...[...this.closed].reverse()].slice(0, MAX_RECENT_RUNS);
    // Ties keep the earliest run, so the reported "longest" does not jump around.
    let longest: StreakRun | null = null;
    for (const run of [...this.closed, ...(currentRun ? [currentRun] : [])]) {
      if (!longest || run.length > longest.length) longest = run;
    }
    return {
      unit,
      current: this.length,
      longest: longest?.length ?? 0,
      currentRun,
      longestRun: longest,
      recentRuns,
      firstReached: this.firstReached,
    };
  }
}

function dailyStreak(schedule: ScheduleInfo, completed: Set<DateString>, today: DateString): Core {
  const tracker = new RunTracker();
  for (const date of scheduledDatesBetween(schedule, schedule.startDate, today)) {
    if (completed.has(date)) tracker.extend(date);
    else if (date !== today) tracker.reset();
  }
  return tracker.result("day");
}

function weeklyStreak(
  schedule: ScheduleInfo,
  completed: Set<DateString>,
  today: DateString,
  weekStartsOn: number,
): Core {
  const target = Math.max(1, schedule.weeklyTarget ?? 1);
  const tracker = new RunTracker();

  const counts = new Map<DateString, number>();
  for (const date of completed) {
    if (date < schedule.startDate) continue;
    const week = startOfWeek(date, weekStartsOn);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }

  const firstWeek = startOfWeek(schedule.startDate, weekStartsOn);
  const currentWeek = startOfWeek(today, weekStartsOn);

  for (let week = firstWeek; week <= currentWeek; week = addDays(week, 7)) {
    const met = (counts.get(week) ?? 0) >= target;
    if (met) tracker.extend(week, addDays(week, 6));
    else if (week === currentWeek || week === firstWeek || touchesPause(schedule, week, addDays(week, 6))) continue;
    else tracker.reset();
  }
  return tracker.result("week");
}

/** Whether any archived period overlaps `[from, to]`. */
function touchesPause(schedule: ScheduleInfo, from: DateString, to: DateString): boolean {
  return (schedule.pauses ?? []).some((pause) => pause.start <= to && (pause.end === null || pause.end > from));
}

/** Number of done days within `[from, to]` (inclusive). */
export function countDoneBetween(done: Iterable<DateString>, from: DateString, to: DateString): number {
  let count = 0;
  for (const date of done) if (date >= from && date <= to) count++;
  return count;
}

/**
 * Overall "perfect day" streak: consecutive days on which *every* fixed-schedule habit that was
 * due got done. Days with nothing due are skipped; WEEKLY habits are not part of this measure.
 */
export function calculatePerfectDayStreak(
  habits: Array<{ id: string; schedule: ScheduleInfo }>,
  doneByHabit: Map<string, Set<DateString>>,
  today: DateString,
): { current: number; longest: number } {
  const fixed = habits.filter((h) => h.schedule.scheduleType !== "WEEKLY");
  if (fixed.length === 0) return { current: 0, longest: 0 };
  const first = fixed.reduce((min, h) => (h.schedule.startDate < min ? h.schedule.startDate : min), today);
  if (first > today) return { current: 0, longest: 0 };

  const due = fixed.map((h) => ({ id: h.id, dates: new Set(scheduledDatesBetween(h.schedule, first, today)) }));

  let run = 0;
  let longest = 0;
  for (const date of eachDay(first, today)) {
    const scheduled = due.filter((h) => h.dates.has(date));
    if (scheduled.length === 0) continue;
    const allDone = scheduled.every((h) => doneByHabit.get(h.id)?.has(date));
    if (allDone) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (date !== today) {
      run = 0;
    }
  }
  return { current: run, longest };
}
