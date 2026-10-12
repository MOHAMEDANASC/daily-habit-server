import { describe, expect, it } from "vitest";
import { complete, createHabit, dailyHabit, signUp } from "../helpers/fixtures";
import * as habitRoute from "@/app/api/habits/[id]/route";
import * as habitsRoute from "@/app/api/habits/route";
import { addDays, todayInTimeZone } from "@/shared/dates";
import { prisma } from "@/lib/prisma";

const today = () => todayInTimeZone("UTC");

describe("habit creation", () => {
  it("creates a habit with a readable schedule", async () => {
    const user = await signUp();
    const result = await user.client.call(habitsRoute.POST, {
      method: "POST",
      path: "/api/habits",
      body: dailyHabit({ name: "  Drink water  ", targetValue: 8, targetUnit: "glasses", reminderTime: "09:30", description: "" }),
    });
    expect(result.status).toBe(201);
    expect(result.data.habit).toMatchObject({
      name: "Drink water",
      description: null,
      scheduleLabel: "Every day",
      targetValue: 8,
      targetUnit: "glasses",
      reminderTime: "09:30",
      isArchived: false,
    });
  });

  it("normalises selected weekdays and weekly targets", async () => {
    const user = await signUp();
    const weekdays = await user.client.call(habitsRoute.POST, {
      method: "POST",
      path: "/api/habits",
      body: dailyHabit({ scheduleType: "SELECTED_DAYS", scheduledDays: [5, 1, 3, 3], weeklyTarget: 4 }),
    });
    expect(weekdays.data.habit).toMatchObject({ scheduledDays: [1, 3, 5], weeklyTarget: null, scheduleLabel: "Mon, Wed, Fri" });

    const weekly = await user.client.call(habitsRoute.POST, {
      method: "POST",
      path: "/api/habits",
      body: dailyHabit({ scheduleType: "WEEKLY", weeklyTarget: 4, scheduledDays: [1] }),
    });
    expect(weekly.data.habit).toMatchObject({ scheduledDays: [], weeklyTarget: 4, scheduleLabel: "4× per week" });
  });

  it.each([
    ["an empty name", { name: "   " }, "name"],
    ["no weekday for a selected-days schedule", { scheduleType: "SELECTED_DAYS", scheduledDays: [] }, "scheduledDays"],
    ["no weekly target", { scheduleType: "WEEKLY" }, "weeklyTarget"],
    ["a custom category without a label", { category: "CUSTOM" }, "customCategory"],
    ["a malformed reminder time", { reminderTime: "25:99" }, "reminderTime"],
    ["a unit without a target", { targetUnit: "pages" }, "targetValue"],
    ["an invalid colour", { color: "red" }, "color"],
    ["an impossible start date", { startDate: "2024-02-31" }, "startDate"],
  ])("rejects %s", async (_label, overrides, field) => {
    const user = await signUp();
    const result = await user.client.call(habitsRoute.POST, {
      method: "POST",
      path: "/api/habits",
      body: dailyHabit(overrides),
    });
    expect(result.status).toBe(400);
    expect(result.body.error?.details).toHaveProperty(field);
  });
});

describe("listing, search, filters and sorting", () => {
  async function seed() {
    const user = await signUp();
    const yoga = await createHabit(user, { name: "Morning yoga", category: "FITNESS" });
    const read = await createHabit(user, { name: "Read a book", category: "LEARNING" });
    const budget = await createHabit(user, { name: "Review budget", category: "FINANCE" });
    await complete(user, read.id, today());
    await user.client.call(habitRoute.PATCH, {
      method: "PATCH",
      path: `/api/habits/${budget.id}`,
      params: { id: budget.id },
      body: { archived: true },
    });
    return { user, yoga, read, budget };
  }

  const list = (user: Awaited<ReturnType<typeof signUp>>, query = "") =>
    user.client.call(habitsRoute.GET, { path: `/api/habits${query}` }).then((r) => r.data.habits as Array<{ name: string; state: string }>);

  it("shows active habits by default and archived ones on request", async () => {
    const { user } = await seed();
    expect((await list(user)).map((h) => h.name).sort()).toEqual(["Morning yoga", "Read a book"]);
    expect((await list(user, "?status=archived")).map((h) => h.name)).toEqual(["Review budget"]);
    expect(await list(user, "?status=all")).toHaveLength(3);
  });

  it("searches by name (case-insensitive) and filters by category", async () => {
    const { user } = await seed();
    expect((await list(user, "?q=YOGA")).map((h) => h.name)).toEqual(["Morning yoga"]);
    expect((await list(user, "?category=LEARNING")).map((h) => h.name)).toEqual(["Read a book"]);
    expect(await list(user, "?q=zzz")).toEqual([]);
  });

  it("filters by completion status for a date", async () => {
    const { user } = await seed();
    expect((await list(user, "?status=completed")).map((h) => h.name)).toEqual(["Read a book"]);
    expect((await list(user, "?status=incomplete")).map((h) => h.name)).toEqual(["Morning yoga"]);
    expect(await list(user, `?status=completed&date=${addDays(today(), -1)}`)).toEqual([]);
  });

  it("sorts by name, creation date and completion status", async () => {
    const { user } = await seed();
    expect((await list(user, "?sort=name&order=asc")).map((h) => h.name)).toEqual(["Morning yoga", "Read a book"]);
    expect((await list(user, "?sort=name&order=desc")).map((h) => h.name)).toEqual(["Read a book", "Morning yoga"]);
    expect((await list(user, "?sort=created&order=asc")).map((h) => h.name)).toEqual(["Morning yoga", "Read a book"]);
    expect((await list(user, "?sort=status&order=asc")).map((h) => h.state)).toEqual(["pending", "done"]);
  });

  it("rejects invalid query parameters", async () => {
    const { user } = await seed();
    const result = await user.client.call(habitsRoute.GET, { path: "/api/habits?sort=banana" });
    expect(result.status).toBe(400);
  });
});

describe("reading, editing, archiving and deleting", () => {
  it("returns habit details with streak information", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { startDate: addDays(today(), -5) });
    await complete(user, habit.id, today());
    await complete(user, habit.id, addDays(today(), -1));

    const result = await user.client.call(habitRoute.GET, { path: `/api/habits/${habit.id}`, params: { id: habit.id } });
    expect(result.status).toBe(200);
    expect(result.data.habit.id).toBe(habit.id);
    expect(result.data.streak).toMatchObject({ unit: "day", current: 2, longest: 2, totalCompletions: 2 });
    expect(result.data.recent).toHaveLength(30);
  });

  it("edits fields and re-validates the merged result", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const patch = (body: Record<string, unknown>) =>
      user.client.call(habitRoute.PATCH, { method: "PATCH", path: `/api/habits/${habit.id}`, params: { id: habit.id }, body });

    const renamed = await patch({ name: "Read 30 minutes", color: "#10b981" });
    expect(renamed.status).toBe(200);
    expect(renamed.data.habit).toMatchObject({ name: "Read 30 minutes", color: "#10b981", scheduleType: "DAILY" });

    // Switching to selected weekdays without choosing any is invalid.
    expect((await patch({ scheduleType: "SELECTED_DAYS" })).status).toBe(400);
    const weekdays = await patch({ scheduleType: "SELECTED_DAYS", scheduledDays: [1, 2, 3, 4, 5] });
    expect(weekdays.data.habit.scheduleLabel).toBe("Weekdays");

    expect((await patch({})).status).toBe(400);
  });

  it("refuses to move the start date past existing completions", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { startDate: addDays(today(), -10) });
    await complete(user, habit.id, addDays(today(), -5));
    const result = await user.client.call(habitRoute.PATCH, {
      method: "PATCH",
      path: `/api/habits/${habit.id}`,
      params: { id: habit.id },
      body: { startDate: addDays(today(), -2) },
    });
    expect(result.status).toBe(409);
  });

  it("archives and reactivates without touching history", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { startDate: addDays(today(), -3) });
    await complete(user, habit.id, addDays(today(), -1));
    const params = { id: habit.id };
    const patch = (body: Record<string, unknown>) =>
      user.client.call(habitRoute.PATCH, { method: "PATCH", path: `/api/habits/${habit.id}`, params, body });

    const archived = await patch({ archived: true });
    expect(archived.data.habit.isArchived).toBe(true);
    expect(await prisma.habitPause.count({ where: { habitId: habit.id, endDate: null } })).toBe(1);
    expect((await complete(user, habit.id, today())).status).toBe(409);

    const active = await patch({ archived: false });
    expect(active.data.habit.isArchived).toBe(false);
    expect(await prisma.habitPause.count({ where: { habitId: habit.id } })).toBe(0); // paused and resumed the same day
    expect(await prisma.habitCompletion.count({ where: { habitId: habit.id } })).toBe(1);
    expect((await complete(user, habit.id, today())).status).toBe(200);
  });

  it("deletes a habit together with its completions", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    await complete(user, habit.id, today());

    const result = await user.client.call(habitRoute.DELETE, { method: "DELETE", path: `/api/habits/${habit.id}`, params: { id: habit.id } });
    expect(result.status).toBe(200);
    expect(await prisma.habit.count()).toBe(0);
    expect(await prisma.habitCompletion.count()).toBe(0);

    const again = await user.client.call(habitRoute.DELETE, { method: "DELETE", path: `/api/habits/${habit.id}`, params: { id: habit.id } });
    expect(again.status).toBe(404);
  });
});
