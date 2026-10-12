import { describe, expect, it } from "vitest";
import { ApiClient } from "../helpers/api-client";
import { complete, createGoal, createHabit, signUp } from "../helpers/fixtures";
import * as analyticsRoute from "@/app/api/analytics/route";
import * as calendarRoute from "@/app/api/calendar/route";
import * as completionsRoute from "@/app/api/completions/route";
import * as dailyRoute from "@/app/api/daily/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as habitCompletions from "@/app/api/habits/[id]/completions/route";
import * as completionByDate from "@/app/api/habits/[id]/completions/[date]/route";
import * as habitRoute from "@/app/api/habits/[id]/route";
import * as habitsRoute from "@/app/api/habits/route";
import * as notificationRoute from "@/app/api/notifications/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as readAll from "@/app/api/notifications/read-all/route";
import * as streaksRoute from "@/app/api/analytics/streaks/route";
import { addDays, todayInTimeZone } from "@/shared/dates";
import { prisma } from "@/lib/prisma";

const today = () => todayInTimeZone("UTC");

async function world() {
  const alice = await signUp({ name: "Alice" });
  const bob = await signUp({ name: "Bob" });
  const habit = await createHabit(alice, { name: "Alice's secret habit", targetValue: 10, startDate: addDays(today(), -5) });
  await complete(alice, habit.id, today(), { progressValue: 10, notes: "private note" });
  const goal = (await createGoal(alice, { title: "Alice goal", metric: "COMPLETIONS", habitId: habit.id, targetValue: 5, startDate: addDays(today(), -5) })).data.goal;
  const notification = await prisma.notification.findFirstOrThrow({ where: { userId: alice.id } });
  return { alice, bob, habit, goal, notification };
}

describe("users cannot read or modify each other's data", () => {
  it("never lists another user's habits, completions or goals", async () => {
    const { bob } = await world();
    expect((await bob.client.call(habitsRoute.GET, { path: "/api/habits?status=all" })).data.habits).toEqual([]);
    expect((await bob.client.call(completionsRoute.GET, { path: "/api/completions" })).data.items).toEqual([]);
    expect((await bob.client.call(goalsRoute.GET, { path: "/api/goals" })).data.goals).toEqual([]);
    expect((await bob.client.call(dailyRoute.GET, { path: "/api/daily" })).data.habits).toEqual([]);
    expect((await bob.client.call(dashboardRoute.GET, { path: "/api/dashboard" })).data.totals.activeHabits).toBe(0);
    expect((await bob.client.call(streaksRoute.GET, { path: "/api/analytics/streaks" })).data.habits).toEqual([]);
    expect((await bob.client.call(calendarRoute.GET, { path: `/api/calendar?month=${today().slice(0, 7)}` })).data.days.every(
      (d: { scheduled: number }) => d.scheduled === 0,
    )).toBe(true);
    expect((await bob.client.call(notificationsRoute.GET, { path: "/api/notifications" })).data.items.every(
      (n: { title: string }) => !n.title.includes("Alice goal"),
    )).toBe(true);
  });

  it("answers 404 for another user's habit on every operation", async () => {
    const { bob, habit } = await world();
    const params = { id: habit.id };
    const attempts = [
      bob.client.call(habitRoute.GET, { path: `/api/habits/${habit.id}`, params }),
      bob.client.call(habitRoute.PATCH, { method: "PATCH", path: `/api/habits/${habit.id}`, params, body: { name: "pwned" } }),
      bob.client.call(habitRoute.PATCH, { method: "PATCH", path: `/api/habits/${habit.id}`, params, body: { archived: true } }),
      bob.client.call(habitRoute.DELETE, { method: "DELETE", path: `/api/habits/${habit.id}`, params }),
      bob.client.call(habitCompletions.GET, { path: `/api/habits/${habit.id}/completions`, params }),
      complete(bob, habit.id, today()),
      bob.client.call(completionByDate.DELETE, {
        method: "DELETE",
        path: `/api/habits/${habit.id}/completions/${today()}`,
        params: { id: habit.id, date: today() },
      }),
    ];
    for (const result of await Promise.all(attempts)) expect(result.status).toBe(404);

    const stored = await prisma.habit.findUniqueOrThrow({ where: { id: habit.id } });
    expect(stored.name).toBe("Alice's secret habit");
    expect(stored.archivedAt).toBeNull();
    const completion = await prisma.habitCompletion.findFirstOrThrow({ where: { habitId: habit.id } });
    expect(completion.notes).toBe("private note");
  });

  it("answers 404 for another user's goal and refuses to link goals to foreign habits", async () => {
    const { bob, habit, goal } = await world();
    const params = { id: goal.id };
    expect((await bob.client.call(goalRoute.GET, { path: `/api/goals/${goal.id}`, params })).status).toBe(404);
    expect((await bob.client.call(goalRoute.PATCH, { method: "PATCH", path: `/api/goals/${goal.id}`, params, body: { title: "pwned" } })).status).toBe(404);
    expect((await bob.client.call(goalRoute.DELETE, { method: "DELETE", path: `/api/goals/${goal.id}`, params })).status).toBe(404);
    expect(await prisma.goal.count()).toBe(1);

    const link = await createGoal(bob, { title: "Sneaky", metric: "COMPLETIONS", habitId: habit.id, targetValue: 3, startDate: today() });
    expect(link.status).toBe(400);
  });

  it("answers 404 for another user's notification and does not expose it in bulk actions", async () => {
    const { alice, bob, notification } = await world();
    const params = { id: notification.id };
    expect(
      (await bob.client.call(notificationRoute.PATCH, { method: "PATCH", path: `/api/notifications/${notification.id}`, params, body: { read: true } })).status,
    ).toBe(404);
    await bob.client.call(readAll.POST, { method: "POST", path: "/api/notifications/read-all" });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeNull();
    expect(alice.id).not.toBe(bob.id);
  });

  it("ignores another user's habit when used as an analytics or history filter", async () => {
    const { bob, habit } = await world();
    const analytics = await bob.client.call(analyticsRoute.GET, { path: `/api/analytics?habitId=${habit.id}` });
    expect(analytics.status).toBe(200);
    expect(analytics.data.habits).toEqual([]);
    const history = await bob.client.call(completionsRoute.GET, { path: `/api/completions?habitId=${habit.id}` });
    expect(history.data.items).toEqual([]);
  });

  it("requires authentication everywhere", async () => {
    const { habit, goal } = await world();
    const anon = new ApiClient();
    const calls = [
      anon.call(habitsRoute.GET, { path: "/api/habits" }),
      anon.call(habitRoute.GET, { path: `/api/habits/${habit.id}`, params: { id: habit.id } }),
      anon.call(dailyRoute.GET, { path: "/api/daily" }),
      anon.call(dashboardRoute.GET, { path: "/api/dashboard" }),
      anon.call(analyticsRoute.GET, { path: "/api/analytics" }),
      anon.call(goalRoute.GET, { path: `/api/goals/${goal.id}`, params: { id: goal.id } }),
      anon.call(notificationsRoute.GET, { path: "/api/notifications" }),
      anon.call(completionByDate.PUT, {
        method: "PUT",
        path: `/api/habits/${habit.id}/completions/${today()}`,
        params: { id: habit.id, date: today() },
        body: {},
      }),
    ];
    for (const result of await Promise.all(calls)) expect(result.status).toBe(401);
  });
});
