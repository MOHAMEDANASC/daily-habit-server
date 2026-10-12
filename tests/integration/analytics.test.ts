import { afterEach, describe, expect, it, vi } from "vitest";
import { complete, createHabit, signUp } from "../helpers/fixtures";
import * as analyticsRoute from "@/app/api/analytics/route";
import * as streaksRoute from "@/app/api/analytics/streaks/route";
import * as calendarRoute from "@/app/api/calendar/route";
import * as dashboardRoute from "@/app/api/dashboard/route";

/** Saturday 2024-06-15, noon UTC. */
const NOW = "2024-06-15T12:00:00Z";

afterEach(() => vi.useRealTimers());

async function seed() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  const user = await signUp({ timeZone: "UTC", name: "Ada Lovelace" });
  // A: every day since 06-01, done 06-10 … 06-15 (6 days).
  const everyday = await createHabit(user, { name: "Every day", category: "LEARNING", startDate: "2024-06-01" });
  // B: weekdays since 06-01, done Mon–Wed of the current week.
  const weekdays = await createHabit(user, {
    name: "Weekdays",
    category: "HEALTH",
    scheduleType: "SELECTED_DAYS",
    scheduledDays: [1, 2, 3, 4, 5],
    startDate: "2024-06-01",
  });
  for (const date of ["2024-06-10", "2024-06-11", "2024-06-12", "2024-06-13", "2024-06-14", "2024-06-15"]) {
    await complete(user, everyday.id, date);
  }
  for (const date of ["2024-06-10", "2024-06-11", "2024-06-12"]) await complete(user, weekdays.id, date);
  return { user, everyday, weekdays };
}

describe("dashboard", () => {
  it("calculates every figure from persisted data", async () => {
    const { user } = await seed();
    const { data } = await user.client.call(dashboardRoute.GET, { path: "/api/dashboard" });

    expect(data.date).toBe("2024-06-15");
    expect(data.user.name).toBe("Ada Lovelace");
    // Saturday: only the daily habit is scheduled, and it is done.
    expect(data.totals).toEqual({ activeHabits: 2, completedToday: 1, scheduledToday: 1, remainingToday: 0, percentage: 100 });
    expect(data.totalCompletions).toBe(9);
    expect(data.streaks.perfectDay).toEqual({ current: 1, longest: 3 });
    expect(data.streaks.topHabits.map((h: { name: string; current: number }) => [h.name, h.current])).toEqual([
      ["Every day", 6],
      ["Weekdays", 0],
    ]);
    // Monday-start week 06-10 … 06-16: 9 of 11 scheduled habit-days so far.
    expect(data.week).toHaveLength(7);
    expect(data.weekProgress).toEqual({ completed: 9, scheduled: 11, percentage: 82 });
    expect(data.todayHabits.map((h: { name: string }) => h.name)).toEqual(["Every day"]);
    expect(data.recentActivity).toHaveLength(8);
  });

  it("is empty-state friendly for a new account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const user = await signUp();
    const { data } = await user.client.call(dashboardRoute.GET, { path: "/api/dashboard" });
    expect(data.totals).toEqual({ activeHabits: 0, completedToday: 0, scheduledToday: 0, remainingToday: 0, percentage: 0 });
    expect(data.todayHabits).toEqual([]);
    expect(data.recentActivity).toEqual([]);
  });
});

describe("calendar", () => {
  it("reports completion levels per day for a month", async () => {
    const { user } = await seed();
    const { data } = await user.client.call(calendarRoute.GET, { path: "/api/calendar?month=2024-06" });
    const day = (date: string) => data.days.find((d: { date: string }) => d.date === date);

    expect(data.days).toHaveLength(30);
    expect(day("2024-06-10")).toMatchObject({ status: "complete", scheduled: 2, completed: 2, percentage: 100 });
    expect(day("2024-06-13")).toMatchObject({ status: "partial", scheduled: 2, completed: 1, percentage: 50 });
    expect(day("2024-06-02")).toMatchObject({ status: "missed", scheduled: 1, completed: 0 });
    expect(day("2024-06-15")).toMatchObject({ isToday: true, isFuture: false });
    expect(day("2024-06-16")).toMatchObject({ isFuture: true });
    expect(day("2024-06-16")).not.toHaveProperty("completionRate");
  });

  it("shows days with nothing scheduled as such", async () => {
    const { user } = await seed();
    const { data } = await user.client.call(calendarRoute.GET, { path: "/api/calendar?month=2024-05" });
    expect(data.days.every((d: { status: string }) => d.status === "none")).toBe(true);
    expect((await user.client.call(calendarRoute.GET, { path: "/api/calendar?month=2024-13" })).status).toBe(400);
  });
});

describe("analytics", () => {
  it("computes rates, comparisons and rankings from real completions", async () => {
    const { user } = await seed();
    const { data } = await user.client.call(analyticsRoute.GET, { path: "/api/analytics" });

    expect(data.range).toEqual({ from: "2024-05-17", to: "2024-06-15", days: 30 });
    expect(data.previous).toEqual({ from: "2024-04-17", to: "2024-05-16" });
    expect(data.hasEnoughData).toBe(true);
    expect(data.totals).toEqual({
      completions: 9,
      previousCompletions: 0,
      rate: 36, // 9 completed of 25 scheduled habit-days
      previousRate: null,
      perfectDays: 4, // 06-10, 06-11, 06-12 and today (only the daily habit is due on a Saturday)
      activeDays: 15,
    });

    const byName = Object.fromEntries(data.habits.map((h: { name: string }) => [h.name, h]));
    expect(byName["Every day"]).toMatchObject({ rate: 40, actual: 6, expected: 15 });
    expect(byName["Weekdays"]).toMatchObject({ rate: 30, actual: 3, expected: 10 });

    expect(data.series.day).toHaveLength(30);
    // Monday-start weeks: 05-13, 05-20, 05-27, 06-03, 06-10 (only the last one has completions).
    expect(data.series.week.map((w: { completed: number }) => w.completed)).toEqual([0, 0, 0, 0, 9]);
    expect(data.series.month.map((m: { date: string }) => m.date)).toEqual(["2024-05-01", "2024-06-01"]);
    expect(data.cumulative.at(-1)).toEqual({ date: "2024-06-15", total: 9 });

    expect(data.categories.map((c: { category: string; rate: number }) => [c.category, c.rate])).toEqual([
      ["LEARNING", 40],
      ["HEALTH", 30],
    ]);
    expect(data.best).toEqual([]); // nothing above 50% yet
    expect(data.needsImprovement.map((h: { name: string }) => h.name)).toEqual(["Weekdays", "Every day"]);
  });

  it("supports date ranges, habit filters and validates input", async () => {
    const { user, everyday } = await seed();
    const week = await user.client.call(analyticsRoute.GET, { path: "/api/analytics?from=2024-06-10&to=2024-06-15" });
    // 6 daily + 5 weekday occurrences are scheduled in 06-10 … 06-15; 9 of those 11 were done.
    expect(week.data.totals).toMatchObject({ completions: 9, rate: 82, perfectDays: 4 });
    expect(week.data.range.days).toBe(6);

    const single = await user.client.call(analyticsRoute.GET, { path: `/api/analytics?habitId=${everyday.id}&from=2024-06-10&to=2024-06-15` });
    expect(single.data.habits).toHaveLength(1);
    expect(single.data.totals).toMatchObject({ completions: 6, rate: 100 });

    expect((await user.client.call(analyticsRoute.GET, { path: "/api/analytics?from=2024-06-15&to=2024-06-01" })).status).toBe(400);
    expect((await user.client.call(analyticsRoute.GET, { path: "/api/analytics?from=2020-01-01&to=2024-06-01" })).status).toBe(400);
  });

  it("reports insufficient data for a brand-new account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const user = await signUp();
    const { data } = await user.client.call(analyticsRoute.GET, { path: "/api/analytics" });
    expect(data.hasEnoughData).toBe(false);
    expect(data.totals.rate).toBeNull();
    expect(data.habits).toEqual([]);
  });

  it("returns streaks per habit", async () => {
    const { user } = await seed();
    const { data } = await user.client.call(streaksRoute.GET, { path: "/api/analytics/streaks" });
    const byName = Object.fromEntries(data.habits.map((h: { name: string }) => [h.name, h]));
    expect(byName["Every day"]).toMatchObject({ current: 6, longest: 6, totalCompletions: 6 });
    expect(byName["Weekdays"]).toMatchObject({ current: 0, longest: 3 });
    expect(data.perfectDay).toEqual({ current: 1, longest: 3 });
  });
});
