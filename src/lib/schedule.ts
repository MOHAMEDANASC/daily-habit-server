import type { ScheduleTypeValue } from "@/shared/habits";
import { eachDay, maxDate, weekdayOf, type DateString } from "@/shared/dates";

/** Half-open range of local days: `start` is included, `end` is not (null = still open). */
export interface DateRange {
  start: DateString;
  end: DateString | null;
}

/** Everything needed to decide whether a habit is scheduled on a calendar day. */
export interface ScheduleInfo {
  scheduleType: ScheduleTypeValue;
  /** 0 = Sunday ... 6 = Saturday; only used by SELECTED_DAYS. */
  scheduledDays: number[];
  /** Completions required each week; only used by WEEKLY. */
  weeklyTarget: number | null;
  startDate: DateString;
  /** Archived periods. Paused days are skipped: they neither extend nor break a streak. */
  pauses?: DateRange[];
}

/** WEEKLY habits have no fixed days: they can be done on any day of the week. */
export function isFlexibleSchedule(schedule: Pick<ScheduleInfo, "scheduleType">): boolean {
  return schedule.scheduleType === "WEEKLY";
}

export function isPausedOn(schedule: ScheduleInfo, date: DateString): boolean {
  return (schedule.pauses ?? []).some((pause) => date >= pause.start && (pause.end === null || date < pause.end));
}

/** True when the habit exists and is not paused on `date`. */
export function isWithinLifetime(schedule: ScheduleInfo, date: DateString): boolean {
  return date >= schedule.startDate && !isPausedOn(schedule, date);
}

/**
 * Whether a habit has a *fixed* occurrence on `date` (DAILY and SELECTED_DAYS).
 * WEEKLY habits are never "scheduled" on a specific day; see `isAvailableOn`.
 */
export function isScheduledOn(schedule: ScheduleInfo, date: DateString): boolean {
  if (!isWithinLifetime(schedule, date)) return false;
  switch (schedule.scheduleType) {
    case "DAILY":
      return true;
    case "SELECTED_DAYS":
      return schedule.scheduledDays.includes(weekdayOf(date));
    case "WEEKLY":
      return false;
  }
}

/** Whether the habit can be logged on `date` (fixed occurrence or flexible weekly habit). */
export function isAvailableOn(schedule: ScheduleInfo, date: DateString): boolean {
  return isFlexibleSchedule(schedule) ? isWithinLifetime(schedule, date) : isScheduledOn(schedule, date);
}

/** Fixed-schedule dates inside `[from, to]`, clamped to the habit's start date. */
export function scheduledDatesBetween(schedule: ScheduleInfo, from: DateString, to: DateString): DateString[] {
  const start = maxDate(from, schedule.startDate);
  if (start > to) return [];
  return eachDay(start, to).filter((date) => isScheduledOn(schedule, date));
}

/** Every day in `[from, to]` on which the habit exists and is not paused. */
export function activeDatesBetween(schedule: ScheduleInfo, from: DateString, to: DateString): DateString[] {
  const start = maxDate(from, schedule.startDate);
  if (start > to) return [];
  return eachDay(start, to).filter((date) => !isPausedOn(schedule, date));
}

export function describeSchedule(schedule: Pick<ScheduleInfo, "scheduleType" | "scheduledDays" | "weeklyTarget">): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (schedule.scheduleType) {
    case "DAILY":
      return "Every day";
    case "SELECTED_DAYS": {
      const days = [...schedule.scheduledDays].sort((a, b) => a - b);
      if (days.length === 5 && days.join() === "1,2,3,4,5") return "Weekdays";
      if (days.length === 2 && days.join() === "0,6") return "Weekends";
      return days.map((d) => names[d]).join(", ");
    }
    case "WEEKLY":
      return `${schedule.weeklyTarget ?? 1}× per week`;
  }
}
