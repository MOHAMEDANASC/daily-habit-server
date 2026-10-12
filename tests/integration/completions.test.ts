import { describe, expect, it } from "vitest";
import { complete, createHabit, signUp } from "../helpers/fixtures";
import * as completionsRoute from "@/app/api/completions/route";
import * as summaryRoute from "@/app/api/completions/summary/route";
import * as dailyRoute from "@/app/api/daily/route";
import * as completionByDate from "@/app/api/habits/[id]/completions/[date]/route";
import * as habitCompletions from "@/app/api/habits/[id]/completions/route";
import { addDays, todayInTimeZone } from "@/shared/dates";
import { prisma } from "@/lib/prisma";

const today = () => todayInTimeZone("UTC");

const daily = (user: Awaited<ReturnType<typeof signUp>>, date?: string) =>
  user.client.call(dailyRoute.GET, { path: `/api/daily${date ? `?date=${date}` : ""}` });

const undo = (user: Awaited<ReturnType<typeof signUp>>, habitId: string, date: string) =>
  user.client.call(completionByDate.DELETE, {
    method: "DELETE",
    path: `/api/habits/${habitId}/completions/${date}`,
    params: { id: habitId, date },
  });

describe("completing and undoing", () => {
  it("marks a habit done and updates the daily percentage immediately", async () => {
    const user = await signUp();
    const read = await createHabit(user, { name: "Read" });
    await createHabit(user, { name: "Exercise" });

    expect((await daily(user)).data.summary).toMatchObject({ scheduled: 2, completed: 0, percentage: 0, status: "missed" });

    const result = await complete(user, read.id, today());
    expect(result.status).toBe(200);
    expect(result.data.habit).toMatchObject({ state: "done", scheduledOnDate: true });

    const after = await daily(user);
    expect(after.data.summary).toMatchObject({ scheduled: 2, completed: 1, percentage: 50, status: "partial" });
    expect(after.data.habits.map((h: { name: string; state: string }) => [h.name, h.state])).toEqual([
      ["Read", "done"],
      ["Exercise", "pending"],
    ]);
  });

  it("undoes a completion and is idempotent", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    await complete(user, habit.id, today());

    const first = await undo(user, habit.id, today());
    expect(first.status).toBe(200);
    expect(first.data.habit.state).toBe("pending");
    expect(await prisma.habitCompletion.count()).toBe(0);

    expect((await undo(user, habit.id, today())).status).toBe(200);
    expect((await daily(user)).data.summary.percentage).toBe(0);
  });

  it("lets users review previous days", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const yesterday = addDays(today(), -1);
    await complete(user, habit.id, yesterday);

    const past = await daily(user, yesterday);
    expect(past.data).toMatchObject({ date: yesterday, isToday: false, isFuture: false });
    expect(past.data.habits[0].state).toBe("done");
    expect(past.data.summary.percentage).toBe(100);
  });
});

describe("duplicate prevention", () => {
  it("keeps a single record when the same completion is submitted repeatedly", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    for (let i = 0; i < 3; i++) expect((await complete(user, habit.id, today())).status).toBe(200);
    expect(await prisma.habitCompletion.count()).toBe(1);
  });

  it("survives concurrent double-submits", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const results = await Promise.all(Array.from({ length: 6 }, () => complete(user, habit.id, today())));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.habitCompletion.count()).toBe(1);
  });

  it("is enforced by a database unique constraint, not just application code", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const data = { habitId: habit.id, completionDate: new Date(`${today()}T00:00:00.000Z`) };
    await prisma.habitCompletion.create({ data });
    await expect(prisma.habitCompletion.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("measurable habits and notes", () => {
  it("only counts a day as done once the target is reached", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { name: "Read", targetValue: 20, targetUnit: "minutes" });

    const partial = await complete(user, habit.id, today(), { progressValue: 8 });
    expect(partial.data.habit).toMatchObject({ state: "partial", progressValue: 8 });
    expect((await daily(user)).data.summary).toMatchObject({ completed: 0, percentage: 0 });

    const reached = await complete(user, habit.id, today(), { progressValue: 20 });
    expect(reached.data.habit).toMatchObject({ state: "done", progressValue: 20 });
    expect((await daily(user)).data.summary.percentage).toBe(100);

    const lowered = await complete(user, habit.id, today(), { progressValue: 12 });
    expect(lowered.data.habit.state).toBe("partial");
    expect(await prisma.habitCompletion.count()).toBe(1);
  });

  it("logs exactly the target when marking a measurable habit complete", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { targetValue: 8, targetUnit: "glasses" });
    const result = await complete(user, habit.id, today(), { completed: true });
    expect(result.data.habit).toMatchObject({ state: "done", progressValue: 8 });
  });

  it("stores notes, keeps them on later updates and can clear them", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const noted = await complete(user, habit.id, today(), { notes: "Felt great" });
    expect(noted.data.habit).toMatchObject({ state: "done", notes: "Felt great" });

    const kept = await complete(user, habit.id, today(), {});
    expect(kept.data.habit.notes).toBe("Felt great");

    const cleared = await complete(user, habit.id, today(), { notes: "" });
    expect(cleared.data.habit.notes).toBeNull();

    const notesOnly = await complete(user, habit.id, addDays(today(), -1), { completed: false, notes: "Skipped, travelling" });
    expect(notesOnly.data.habit).toMatchObject({ state: "pending", notes: "Skipped, travelling" });
  });

  it("rejects negative progress", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { targetValue: 5 });
    expect((await complete(user, habit.id, today(), { progressValue: -1 })).status).toBe(400);
  });
});

describe("which days can be logged", () => {
  it("rejects future days", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const result = await complete(user, habit.id, addDays(today(), 1));
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("FUTURE_DATE");
  });

  it("rejects days before the start date and unscheduled weekdays", async () => {
    const user = await signUp();
    // 2024-05-06 is a Monday; the habit runs Mondays only from 2024-05-06.
    const mondays = await createHabit(user, { scheduleType: "SELECTED_DAYS", scheduledDays: [1], startDate: "2024-05-06" });
    expect((await complete(user, mondays.id, "2024-04-29")).status).toBe(422);
    expect((await complete(user, mondays.id, "2024-05-07")).status).toBe(422);
    expect((await complete(user, mondays.id, "2024-05-13")).status).toBe(200);
  });

  it("rejects malformed dates", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    expect((await complete(user, habit.id, "2024-02-31")).status).toBe(400);
    expect((await complete(user, habit.id, "yesterday")).status).toBe(400);
  });

  it("shows only habits scheduled on the selected date", async () => {
    const user = await signUp();
    await createHabit(user, { name: "Every day" });
    await createHabit(user, { name: "Mondays", scheduleType: "SELECTED_DAYS", scheduledDays: [1] });
    await createHabit(user, { name: "Three a week", scheduleType: "WEEKLY", weeklyTarget: 3 });

    const monday = await daily(user, "2024-05-06");
    const tuesday = await daily(user, "2024-05-07");
    expect(monday.data.habits.map((h: { name: string }) => h.name).sort()).toEqual(["Every day", "Mondays", "Three a week"]);
    expect(tuesday.data.habits.map((h: { name: string }) => h.name).sort()).toEqual(["Every day", "Three a week"]);
    expect(monday.data.summary.scheduled).toBe(2); // the weekly habit is flexible: it only counts once done
  });

  it("tracks weekly habits against their weekly target", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { scheduleType: "WEEKLY", weeklyTarget: 3, startDate: "2024-05-01" });
    await complete(user, habit.id, "2024-05-06");
    const second = await complete(user, habit.id, "2024-05-08");
    expect(second.data.habit.weekly).toEqual({ count: 2, target: 3 });
    expect((await daily(user, "2024-05-08")).data.summary).toMatchObject({ scheduled: 1, completed: 1 });
  });
});

describe("history and summaries", () => {
  async function seed() {
    const user = await signUp();
    const habit = await createHabit(user, { startDate: addDays(today(), -10) });
    for (const offset of [0, 1, 2, 4, 6]) await complete(user, habit.id, addDays(today(), -offset));
    return { user, habit };
  }

  it("paginates completion history newest first", async () => {
    const { user } = await seed();
    const first = await user.client.call(completionsRoute.GET, { path: "/api/completions?pageSize=2&page=1" });
    expect(first.data).toMatchObject({ total: 5, page: 1, pageSize: 2, hasMore: true });
    expect(first.data.items.map((i: { date: string }) => i.date)).toEqual([today(), addDays(today(), -1)]);

    const last = await user.client.call(completionsRoute.GET, { path: "/api/completions?pageSize=2&page=3" });
    expect(last.data.items).toHaveLength(1);
    expect(last.data.hasMore).toBe(false);
  });

  it("filters history by date range and habit", async () => {
    const { user, habit } = await seed();
    const range = await user.client.call(completionsRoute.GET, {
      path: `/api/completions?from=${addDays(today(), -2)}&to=${today()}`,
    });
    expect(range.data.total).toBe(3);

    const forHabit = await user.client.call(habitCompletions.GET, {
      path: `/api/habits/${habit.id}/completions`,
      params: { id: habit.id },
    });
    expect(forHabit.data.total).toBe(5);
  });

  it("summarises days across a range", async () => {
    const { user } = await seed();
    const result = await user.client.call(summaryRoute.GET, {
      path: `/api/completions/summary?from=${addDays(today(), -3)}&to=${today()}`,
    });
    expect(result.data.days.map((d: { percentage: number }) => d.percentage)).toEqual([0, 100, 100, 100]);

    const tooLong = await user.client.call(summaryRoute.GET, { path: "/api/completions/summary?from=2020-01-01&to=2024-01-01" });
    expect(tooLong.status).toBe(400);
  });
});
