import { completionPercentage } from "@/shared/completion-rules";
import { addDays, eachDay, minDate, startOfWeek, type DateString } from "@/shared/dates";
import {
  activeDatesBetween,
  isScheduledOn,
  isWithinLifetime,
  scheduledDatesBetween,
  type ScheduleInfo,
} from "@/lib/schedule";
import { countDoneBetween } from "@/lib/streaks";

export interface StatHabit {
  id: string;
  schedule: ScheduleInfo;
}

/** habitId → the local dates on which it was done. */
export type DoneMap = Map<string, Set<DateString>>;

export type DayStatus = "none" | "missed" | "partial" | "complete";

export interface DaySummary {
  date: DateString;
  scheduled: number;
  completed: number;
  percentage: number;
  status: DayStatus;
}

/**
 * Summarise one day.
 *
 * A habit counts toward the day when it has a fixed occurrence that day, or when it was done
 * that day anyway (flexible WEEKLY habits and bonus completions). That means flexible habits
 * can only ever raise a day's percentage, never lower it.
 */
export function summarizeDay(habits: StatHabit[], done: DoneMap, date: DateString): DaySummary {
  let scheduled = 0;
  let completed = 0;
  for (const habit of habits) {
    const isDone = done.get(habit.id)?.has(date) ?? false;
    if (isScheduledOn(habit.schedule, date)) {
      scheduled++;
      if (isDone) completed++;
    } else if (isDone && isWithinLifetime(habit.schedule, date)) {
      scheduled++;
      completed++;
    }
  }
  const status: DayStatus =
    scheduled === 0 ? "none" : completed === 0 ? "missed" : completed < scheduled ? "partial" : "complete";
  return { date, scheduled, completed, percentage: completionPercentage(completed, scheduled), status };
}

export function summarizeRange(habits: StatHabit[], done: DoneMap, from: DateString, to: DateString): DaySummary[] {
  return eachDay(from, to).map((date) => summarizeDay(habits, done, date));
}

export interface RateResult {
  /** Number of expected completions in the window (fractional for WEEKLY habits). */
  expected: number;
  actual: number;
  /** 0–1, or null when nothing was expected yet. */
  rate: number | null;
}

/**
 * Completion rate of one habit inside `[from, to]` (clamped to its lifetime and to `today`).
 * An open occurrence today is not held against the user.
 */
export function habitRate(
  habit: StatHabit,
  done: Set<DateString>,
  from: DateString,
  to: DateString,
  today: DateString,
): RateResult {
  const { schedule } = habit;
  const windowEnd = minDate(to, today);

  if (schedule.scheduleType === "WEEKLY") {
    const days = activeDatesBetween(schedule, from, windowEnd);
    if (days.length === 0) return { expected: 0, actual: 0, rate: null };
    const expected = ((schedule.weeklyTarget ?? 1) * days.length) / 7;
    const actual = days.filter((date) => done.has(date)).length;
    return { expected, actual, rate: Math.min(1, actual / expected) };
  }

  const dates = scheduledDatesBetween(schedule, from, windowEnd).filter((d) => d !== today || done.has(d));
  const actual = dates.filter((d) => done.has(d)).length;
  return { expected: dates.length, actual, rate: dates.length > 0 ? actual / dates.length : null };
}

export interface WeeklyProgress {
  count: number;
  target: number;
  weekStart: DateString;
  weekEnd: DateString;
}

export function weeklyProgress(
  schedule: ScheduleInfo,
  done: Set<DateString>,
  date: DateString,
  weekStartsOn: number,
): WeeklyProgress {
  const weekStart = startOfWeek(date, weekStartsOn);
  const weekEnd = addDays(weekStart, 6);
  return {
    count: countDoneBetween(done, weekStart, weekEnd),
    target: schedule.weeklyTarget ?? 1,
    weekStart,
    weekEnd,
  };
}
