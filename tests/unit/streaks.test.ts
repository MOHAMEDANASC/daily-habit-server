import { describe, expect, it } from "vitest";
import { addDays, eachDay } from "@/shared/dates";
import type { ScheduleInfo } from "@/lib/schedule";
import { calculatePerfectDayStreak, calculateStreak } from "@/lib/streaks";

const daily = (startDate: string, extra: Partial<ScheduleInfo> = {}): ScheduleInfo => ({
  scheduleType: "DAILY",
  scheduledDays: [],
  weeklyTarget: null,
  startDate,
  ...extra,
});

const weekdays = (startDate: string): ScheduleInfo => ({
  scheduleType: "SELECTED_DAYS",
  scheduledDays: [1, 2, 3, 4, 5],
  weeklyTarget: null,
  startDate,
});

const weekly = (startDate: string, target: number): ScheduleInfo => ({
  scheduleType: "WEEKLY",
  scheduledDays: [],
  weeklyTarget: target,
  startDate,
});

describe("daily streaks", () => {
  it("is zero with no completions", () => {
    const result = calculateStreak(daily("2024-05-01"), [], "2024-05-10");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(0);
    expect(result.totalCompletions).toBe(0);
    expect(result.lastCompletedOn).toBeNull();
  });

  it("counts consecutive completed days up to today", () => {
    const done = eachDay("2024-05-06", "2024-05-10");
    const result = calculateStreak(daily("2024-05-01"), done, "2024-05-10");
    expect(result.current).toBe(5);
    expect(result.longest).toBe(5);
    expect(result.currentRun).toEqual({ start: "2024-05-06", end: "2024-05-10", length: 5 });
  });

  it("does not break the streak while today is still open", () => {
    const done = eachDay("2024-05-06", "2024-05-09");
    const result = calculateStreak(daily("2024-05-01"), done, "2024-05-10");
    expect(result.current).toBe(4);
  });

  it("breaks the streak when yesterday was missed", () => {
    const done = ["2024-05-07", "2024-05-08", "2024-05-10"];
    const result = calculateStreak(daily("2024-05-01"), done, "2024-05-10");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(2);
    expect(result.longestRun).toEqual({ start: "2024-05-07", end: "2024-05-08", length: 2 });
  });

  it("resets to zero when the last scheduled day was missed and today is open", () => {
    const result = calculateStreak(daily("2024-05-01"), ["2024-05-07", "2024-05-08"], "2024-05-10");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(2);
  });

  it("tracks the longest run separately from the current one", () => {
    const done = [...eachDay("2024-05-01", "2024-05-05"), ...eachDay("2024-05-08", "2024-05-09")];
    const result = calculateStreak(daily("2024-05-01"), done, "2024-05-09");
    expect(result.longest).toBe(5);
    expect(result.current).toBe(2);
    expect(result.recentRuns.map((r) => r.length)).toEqual([2, 5]);
  });

  it("ignores completions before the start date for streaks", () => {
    const result = calculateStreak(daily("2024-05-08"), ["2024-05-01", "2024-05-02", "2024-05-08"], "2024-05-08");
    expect(result.current).toBe(1);
  });

  it("records when each streak length was first reached", () => {
    const result = calculateStreak(daily("2024-05-01"), eachDay("2024-05-01", "2024-05-04"), "2024-05-04");
    expect(result.firstReached.get(3)).toBe("2024-05-03");
    expect(result.firstReached.get(5)).toBeUndefined();
  });
});

describe("schedule-aware streaks", () => {
  it("does not lose a weekday streak over an unscheduled weekend", () => {
    // Mon 2024-05-06 .. Fri 2024-05-10 and Mon 2024-05-13 done; weekend skipped.
    const done = [...eachDay("2024-05-06", "2024-05-10"), "2024-05-13"];
    const result = calculateStreak(weekdays("2024-05-01"), done, "2024-05-13");
    expect(result.current).toBe(6);
  });

  it("stays alive on a Saturday after a completed Friday", () => {
    const done = eachDay("2024-05-06", "2024-05-10");
    const result = calculateStreak(weekdays("2024-05-01"), done, "2024-05-11");
    expect(result.current).toBe(5);
  });

  it("still breaks when a scheduled weekday is missed", () => {
    const done = ["2024-05-06", "2024-05-07", "2024-05-09", "2024-05-10"];
    const result = calculateStreak(weekdays("2024-05-06"), done, "2024-05-10");
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it("does not count bonus completions on unscheduled days toward the streak", () => {
    const done = ["2024-05-10", "2024-05-11", "2024-05-13"];
    const result = calculateStreak(weekdays("2024-05-06"), done, "2024-05-13");
    // Fri + Mon scheduled (Sat bonus ignored) but Mon-Thu this week were missed.
    expect(result.current).toBe(2);
    expect(result.totalCompletions).toBe(3);
  });

  it("treats archived days as neutral so a reactivated habit keeps its streak", () => {
    const schedule = daily("2024-05-01", { pauses: [{ start: "2024-05-05", end: "2024-05-10" }] });
    const done = [...eachDay("2024-05-01", "2024-05-04"), "2024-05-10", "2024-05-11"];
    const result = calculateStreak(schedule, done, "2024-05-11");
    expect(result.current).toBe(6);
  });

  it("does not count an archived habit's days as missed", () => {
    const schedule = daily("2024-05-01", { pauses: [{ start: "2024-05-05", end: null }] });
    const result = calculateStreak(schedule, eachDay("2024-05-01", "2024-05-04"), "2024-05-20");
    expect(result.current).toBe(4);
  });
});

describe("weekly streaks", () => {
  it("counts consecutive weeks that hit the weekly target", () => {
    // Weeks start Monday. Target 3.
    const done = [
      "2024-05-06", "2024-05-08", "2024-05-10", // week of 05-06: 3 → met
      "2024-05-13", "2024-05-15", "2024-05-17", // week of 05-13: 3 → met
    ];
    const result = calculateStreak(weekly("2024-05-06", 3), done, "2024-05-19", 1);
    expect(result.unit).toBe("week");
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it("does not penalise the current, unfinished week", () => {
    const done = ["2024-05-06", "2024-05-08", "2024-05-10"];
    const result = calculateStreak(weekly("2024-05-06", 3), done, "2024-05-14", 1);
    expect(result.current).toBe(1);
  });

  it("breaks after a past week that missed its target", () => {
    const done = [
      "2024-05-06", "2024-05-08", "2024-05-10", // met
      "2024-05-13", // week of 05-13 only 1 → missed
    ];
    const result = calculateStreak(weekly("2024-05-06", 3), done, "2024-05-22", 1);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(1);
  });

  it("gives the first partial week a grace pass", () => {
    // Start on Friday; only 1 of 3 done that week, then two full weeks hit the target.
    const done = [
      "2024-05-10",
      "2024-05-13", "2024-05-14", "2024-05-15",
      "2024-05-20", "2024-05-21", "2024-05-22",
    ];
    const result = calculateStreak(weekly("2024-05-10", 3), done, "2024-05-26", 1);
    expect(result.current).toBe(2);
  });

  it("respects the Sunday week start preference", () => {
    // Sun 2024-05-12 .. Sat 2024-05-18 is one week when weeks start on Sunday.
    const done = ["2024-05-12", "2024-05-14", "2024-05-18"];
    const sunday = calculateStreak(weekly("2024-05-12", 3), done, "2024-05-19", 0);
    const monday = calculateStreak(weekly("2024-05-12", 3), done, "2024-05-19", 1);
    expect(sunday.current).toBe(1);
    expect(monday.current).toBe(0);
  });
});

describe("perfect-day streak", () => {
  const habits = [
    { id: "a", schedule: daily("2024-05-01") },
    { id: "b", schedule: weekdays("2024-05-01") },
  ];

  it("requires every due habit to be done", () => {
    const done = new Map([
      ["a", new Set(eachDay("2024-05-01", "2024-05-10"))],
      ["b", new Set(["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-06", "2024-05-07", "2024-05-09", "2024-05-10"])],
    ]);
    // Habit b misses Thu 2024-05-08, so the perfect streak restarts on Fri 05-09.
    const result = calculatePerfectDayStreak(habits, done, "2024-05-10");
    expect(result.current).toBe(2);
    expect(result.longest).toBe(7);
  });

  it("is not broken by a still-open today", () => {
    // Everything done Wed 05-01 .. Thu 05-09; Friday 05-10 (today) has nothing done yet.
    const everyDay = new Set(eachDay("2024-05-01", "2024-05-09"));
    const done = new Map([
      ["a", everyDay],
      ["b", everyDay],
    ]);
    const result = calculatePerfectDayStreak(habits, done, addDays("2024-05-09", 1));
    expect(result).toEqual({ current: 9, longest: 9 });
  });

  it("ignores weekly habits and returns zero with none scheduled", () => {
    expect(calculatePerfectDayStreak([{ id: "w", schedule: weekly("2024-05-01", 3) }], new Map(), "2024-05-10")).toEqual({
      current: 0,
      longest: 0,
    });
  });
});
