import { describe, expect, it } from "vitest";
import { completionPercentage, resolveProgress } from "@/shared/completion-rules";
import { describeSchedule, isAvailableOn, isScheduledOn, scheduledDatesBetween, type ScheduleInfo } from "@/lib/schedule";
import { habitRate, summarizeDay, summarizeRange, weeklyProgress, type StatHabit } from "@/lib/stats";

const daily: ScheduleInfo = { scheduleType: "DAILY", scheduledDays: [], weeklyTarget: null, startDate: "2024-05-01" };
const monWedFri: ScheduleInfo = {
  scheduleType: "SELECTED_DAYS",
  scheduledDays: [1, 3, 5],
  weeklyTarget: null,
  startDate: "2024-05-01",
};
const weekly: ScheduleInfo = { scheduleType: "WEEKLY", scheduledDays: [], weeklyTarget: 3, startDate: "2024-05-01" };

describe("scheduled-day calculations", () => {
  it("schedules daily habits every day from the start date", () => {
    expect(isScheduledOn(daily, "2024-04-30")).toBe(false);
    expect(isScheduledOn(daily, "2024-05-01")).toBe(true);
    expect(isScheduledOn(daily, "2024-09-09")).toBe(true);
  });

  it("schedules only the selected weekdays", () => {
    // 2024-05-06 Mon, 05-07 Tue, 05-08 Wed.
    expect(isScheduledOn(monWedFri, "2024-05-06")).toBe(true);
    expect(isScheduledOn(monWedFri, "2024-05-07")).toBe(false);
    expect(isScheduledOn(monWedFri, "2024-05-08")).toBe(true);
    expect(scheduledDatesBetween(monWedFri, "2024-05-06", "2024-05-12")).toEqual([
      "2024-05-06",
      "2024-05-08",
      "2024-05-10",
    ]);
  });

  it("treats weekly habits as available but never fixed", () => {
    expect(isScheduledOn(weekly, "2024-05-06")).toBe(false);
    expect(isAvailableOn(weekly, "2024-05-06")).toBe(true);
    expect(isAvailableOn(weekly, "2024-04-01")).toBe(false);
  });

  it("skips archived (paused) days, including an open-ended pause", () => {
    const paused = { ...daily, pauses: [{ start: "2024-05-03", end: "2024-05-05" }] };
    expect(scheduledDatesBetween(paused, "2024-05-01", "2024-05-06")).toEqual([
      "2024-05-01",
      "2024-05-02",
      "2024-05-05",
      "2024-05-06",
    ]);
    const archived = { ...daily, pauses: [{ start: "2024-05-04", end: null }] };
    expect(scheduledDatesBetween(archived, "2024-05-01", "2024-05-31")).toEqual(["2024-05-01", "2024-05-02", "2024-05-03"]);
    expect(isAvailableOn(archived, "2024-05-04")).toBe(false);
  });

  it("describes schedules for display", () => {
    expect(describeSchedule(daily)).toBe("Every day");
    expect(describeSchedule({ ...monWedFri, scheduledDays: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(describeSchedule(monWedFri)).toBe("Mon, Wed, Fri");
    expect(describeSchedule(weekly)).toBe("3× per week");
  });
});

describe("completion percentages", () => {
  it("rounds to whole numbers and handles empty days", () => {
    expect(completionPercentage(0, 0)).toBe(0);
    expect(completionPercentage(1, 3)).toBe(33);
    expect(completionPercentage(2, 3)).toBe(67);
    expect(completionPercentage(3, 3)).toBe(100);
    expect(completionPercentage(5, 3)).toBe(100);
  });

  it("resolves check-off habits", () => {
    expect(resolveProgress({ targetValue: null })).toEqual({ done: true, progressValue: null });
    expect(resolveProgress({ targetValue: null, completed: false })).toEqual({ done: false, progressValue: null });
  });

  it("resolves measurable habits against their target", () => {
    expect(resolveProgress({ targetValue: 20, progressValue: 10 })).toEqual({ done: false, progressValue: 10 });
    expect(resolveProgress({ targetValue: 20, progressValue: 20 })).toEqual({ done: true, progressValue: 20 });
    expect(resolveProgress({ targetValue: 20, progressValue: 35 })).toEqual({ done: true, progressValue: 35 });
    expect(resolveProgress({ targetValue: 20, completed: true })).toEqual({ done: true, progressValue: 20 });
    expect(resolveProgress({ targetValue: 20, completed: false })).toEqual({ done: false, progressValue: null });
  });
});

describe("daily summaries", () => {
  const habits: StatHabit[] = [
    { id: "daily", schedule: daily },
    { id: "mwf", schedule: monWedFri },
    { id: "weekly", schedule: weekly },
  ];

  it("counts scheduled habits and completions for a day", () => {
    // Monday 2024-05-06: daily + mwf are due; weekly is flexible.
    const done = new Map([["daily", new Set(["2024-05-06"])]]);
    const summary = summarizeDay(habits, done, "2024-05-06");
    expect(summary).toMatchObject({ scheduled: 2, completed: 1, percentage: 50, status: "partial" });
  });

  it("only counts flexible habits on days they were actually done", () => {
    const done = new Map([
      ["daily", new Set(["2024-05-07"])],
      ["weekly", new Set(["2024-05-07"])],
    ]);
    // Tuesday: daily due (mwf not), weekly done as a bonus.
    expect(summarizeDay(habits, done, "2024-05-07")).toMatchObject({ scheduled: 2, completed: 2, status: "complete" });
  });

  it("reports days with nothing scheduled and fully missed days", () => {
    const onlyMwf: StatHabit[] = [{ id: "mwf", schedule: monWedFri }];
    expect(summarizeDay(onlyMwf, new Map(), "2024-05-07").status).toBe("none");
    expect(summarizeDay(onlyMwf, new Map(), "2024-05-06").status).toBe("missed");
  });

  it("summarises ranges", () => {
    const range = summarizeRange([{ id: "daily", schedule: daily }], new Map(), "2024-05-01", "2024-05-03");
    expect(range).toHaveLength(3);
    expect(range.every((day) => day.scheduled === 1)).toBe(true);
  });
});

describe("habit completion rates", () => {
  const habit: StatHabit = { id: "daily", schedule: daily };

  it("divides done days by scheduled days and skips an open today", () => {
    const done = new Set(["2024-05-01", "2024-05-02", "2024-05-04"]);
    const result = habitRate(habit, done, "2024-05-01", "2024-05-31", "2024-05-05");
    expect(result.expected).toBe(4); // 05-01..05-04; today (05-05) is open so it is excluded
    expect(result.actual).toBe(3);
    expect(result.rate).toBeCloseTo(0.75);
  });

  it("includes today when it is already done", () => {
    const result = habitRate(habit, new Set(["2024-05-05"]), "2024-05-05", "2024-05-31", "2024-05-05");
    expect(result).toMatchObject({ expected: 1, actual: 1, rate: 1 });
  });

  it("returns null when nothing was expected", () => {
    expect(habitRate(habit, new Set(), "2024-04-01", "2024-04-30", "2024-05-05").rate).toBeNull();
  });

  it("pro-rates weekly habits and caps the rate at 100%", () => {
    const flexible: StatHabit = { id: "w", schedule: weekly };
    const done = new Set(["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05", "2024-05-06", "2024-05-07"]);
    const result = habitRate(flexible, done, "2024-05-01", "2024-05-07", "2024-05-07");
    expect(result.expected).toBe(3);
    expect(result.rate).toBe(1);
  });

  it("measures progress in the current week", () => {
    const progress = weeklyProgress(weekly, new Set(["2024-05-06", "2024-05-08", "2024-05-01"]), "2024-05-09", 1);
    expect(progress).toEqual({ count: 2, target: 3, weekStart: "2024-05-06", weekEnd: "2024-05-12" });
  });
});
