import { describe, expect, it } from "vitest";
import { complete, createGoal, createHabit, signUp } from "../helpers/fixtures";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as notificationRoute from "@/app/api/notifications/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as preferencesRoute from "@/app/api/notifications/preferences/route";
import * as readAllRoute from "@/app/api/notifications/read-all/route";
import * as completionByDate from "@/app/api/habits/[id]/completions/[date]/route";
import { addDays, todayInTimeZone } from "@/shared/dates";
import { prisma } from "@/lib/prisma";

const today = () => todayInTimeZone("UTC");

describe("goals", () => {
  it("validates goal input", async () => {
    const user = await signUp();
    const habit = await createHabit(user);
    const create = (body: Record<string, unknown>) =>
      createGoal(user, { title: "G", metric: "COMPLETIONS", targetValue: 3, startDate: today(), habitId: habit.id, ...body });

    expect((await create({ title: "" })).body.error?.details).toHaveProperty("title");
    expect((await create({ targetValue: 0 })).body.error?.details).toHaveProperty("targetValue");
    expect((await create({ targetValue: 2.5 })).body.error?.details).toHaveProperty("targetValue");
    expect((await create({ metric: "STREAK", habitId: null })).body.error?.details).toHaveProperty("habitId");
    expect((await create({ targetDate: addDays(today(), -1) })).body.error?.details).toHaveProperty("targetDate");
    // Quantity goals need a habit with a measurable target.
    expect((await create({ metric: "QUANTITY" })).body.error?.details).toHaveProperty("habitId");
  });

  it("tracks progress, reaches the target, notifies once and reverts when a completion is undone", async () => {
    const user = await signUp();
    const habit = await createHabit(user, { name: "Meditate", startDate: addDays(today(), -10) });
    const created = await createGoal(user, {
      title: "Meditate 4 days",
      metric: "COMPLETIONS",
      habitId: habit.id,
      targetValue: 4,
      startDate: addDays(today(), -10),
    });
    expect(created.status).toBe(201);
    const id = created.data.goal.id;
    const read = async () =>
      (await user.client.call(goalRoute.GET, { path: `/api/goals/${id}`, params: { id } })).data.goal;

    expect(await read()).toMatchObject({ currentValue: 0, progress: 0, status: "ACTIVE" });

    await complete(user, habit.id, addDays(today(), -3));
    await complete(user, habit.id, addDays(today(), -2));
    const half = await read();
    expect(half).toMatchObject({ currentValue: 2, progress: 0.5, status: "ACTIVE" });
    expect(half.milestones.map((m: { percent: number; reached: boolean }) => [m.percent, m.reached])).toEqual([
      [25, true],
      [50, true],
      [75, false],
      [100, false],
    ]);
    expect(half.milestones[1].reachedOn).toBe(addDays(today(), -2));

    await complete(user, habit.id, addDays(today(), -1));
    await complete(user, habit.id, today());
    const reached = await read();
    expect(reached).toMatchObject({ currentValue: 4, progress: 1, status: "COMPLETED" });
    expect(reached.completedAt).not.toBeNull();
    expect(reached.milestones.at(-1)).toMatchObject({ percent: 100, reached: true, reachedOn: today() });
    expect(await prisma.notification.count({ where: { userId: user.id, type: "MILESTONE" } })).toBe(1);

    await user.client.call(completionByDate.DELETE, {
      method: "DELETE",
      path: `/api/habits/${habit.id}/completions/${today()}`,
      params: { id: habit.id, date: today() },
    });
    expect(await read()).toMatchObject({ currentValue: 3, status: "ACTIVE", completedAt: null });
  });

  it("supports streak goals and measurable quantity goals", async () => {
    const user = await signUp();
    const water = await createHabit(user, { name: "Water", targetValue: 8, targetUnit: "glasses", startDate: addDays(today(), -5) });
    const streak = (await createGoal(user, { title: "3-day streak", metric: "STREAK", habitId: water.id, targetValue: 3, startDate: addDays(today(), -5) })).data.goal;
    const quantity = (await createGoal(user, { title: "30 glasses", metric: "QUANTITY", habitId: water.id, targetValue: 30, startDate: addDays(today(), -5) })).data.goal;

    await complete(user, water.id, addDays(today(), -2), { progressValue: 8 });
    await complete(user, water.id, addDays(today(), -1), { progressValue: 8 });
    await complete(user, water.id, today(), { progressValue: 5 }); // partial day: counts for quantity, not for the streak

    const goals = (await user.client.call(goalsRoute.GET, { path: "/api/goals" })).data.goals as Array<{ id: string; currentValue: number; unitLabel: string }>;
    expect(goals.find((g) => g.id === streak.id)).toMatchObject({ currentValue: 2, unitLabel: "days in a row" });
    expect(goals.find((g) => g.id === quantity.id)).toMatchObject({ currentValue: 21, unitLabel: "glasses" });

    await complete(user, water.id, today(), { progressValue: 9 });
    const after = (await user.client.call(goalsRoute.GET, { path: "/api/goals?status=COMPLETED" })).data.goals;
    expect(after.map((g: { title: string }) => g.title)).toEqual(["3-day streak"]);
  });

  it("does not notify when milestone alerts are off, and supports edit, archive and delete", async () => {
    const user = await signUp();
    await user.client.call(preferencesRoute.PATCH, { method: "PATCH", path: "/api/notifications/preferences", body: { milestoneAlerts: false } });
    const habit = await createHabit(user, { startDate: addDays(today(), -2) });
    const goal = (await createGoal(user, { title: "One day", metric: "COMPLETIONS", habitId: habit.id, targetValue: 1, startDate: addDays(today(), -2) })).data.goal;
    await complete(user, habit.id, today());
    expect(await prisma.notification.count({ where: { userId: user.id, type: "MILESTONE" } })).toBe(0);
    expect((await user.client.call(goalRoute.GET, { path: `/api/goals/${goal.id}`, params: { id: goal.id } })).data.goal.status).toBe("COMPLETED");

    const params = { id: goal.id };
    const renamed = await user.client.call(goalRoute.PATCH, { method: "PATCH", path: `/api/goals/${goal.id}`, params, body: { title: "Renamed", targetValue: 5 } });
    expect(renamed.data.goal).toMatchObject({ title: "Renamed", targetValue: 5, status: "ACTIVE" });
    const archived = await user.client.call(goalRoute.PATCH, { method: "PATCH", path: `/api/goals/${goal.id}`, params, body: { status: "ARCHIVED" } });
    expect(archived.data.goal.status).toBe("ARCHIVED");
    expect((await user.client.call(goalRoute.DELETE, { method: "DELETE", path: `/api/goals/${goal.id}`, params })).status).toBe(200);
    expect(await prisma.goal.count()).toBe(0);
  });
});

describe("notifications", () => {
  it("lists, reads, dismisses and bulk-reads notifications", async () => {
    const user = await signUp();
    await prisma.notification.createMany({
      data: [1, 2, 3].map((n) => ({ userId: user.id, title: `Note ${n}`, message: "Hello", type: "SYSTEM" as const })),
    });

    const list = await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    expect(list.data.total).toBe(4); // three + the welcome message
    expect(list.data.unreadCount).toBe(4);
    const [first, second] = list.data.items;

    const read = await user.client.call(notificationRoute.PATCH, {
      method: "PATCH",
      path: `/api/notifications/${first.id}`,
      params: { id: first.id },
      body: { read: true },
    });
    expect(read.data.notification.readAt).not.toBeNull();

    const dismissed = await user.client.call(notificationRoute.PATCH, {
      method: "PATCH",
      path: `/api/notifications/${second.id}`,
      params: { id: second.id },
      body: { dismissed: true },
    });
    expect(dismissed.status).toBe(200);

    const unread = await user.client.call(notificationsRoute.GET, { path: "/api/notifications?status=unread" });
    expect(unread.data).toMatchObject({ total: 2, unreadCount: 2 });
    expect(unread.data.items.map((n: { id: string }) => n.id)).not.toContain(second.id);

    await user.client.call(readAllRoute.POST, { method: "POST", path: "/api/notifications/read-all" });
    const after = await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    expect(after.data).toMatchObject({ total: 3, unreadCount: 0 });
  });

  it("paginates", async () => {
    const user = await signUp();
    await prisma.notification.createMany({
      data: Array.from({ length: 5 }, (_, n) => ({ userId: user.id, title: `N${n}`, message: "m", type: "SYSTEM" as const })),
    });
    const page = await user.client.call(notificationsRoute.GET, { path: "/api/notifications?pageSize=4&page=2" });
    expect(page.data).toMatchObject({ page: 2, total: 6, hasMore: false });
    expect(page.data.items).toHaveLength(2);
  });

  it("reads and updates notification preferences", async () => {
    const user = await signUp();
    const initial = await user.client.call(preferencesRoute.GET, { path: "/api/notifications/preferences" });
    expect(initial.data.preferences).toEqual({ remindersEnabled: true, milestoneAlerts: true, browserNotifications: false });

    const updated = await user.client.call(preferencesRoute.PATCH, {
      method: "PATCH",
      path: "/api/notifications/preferences",
      body: { remindersEnabled: false, browserNotifications: true },
    });
    expect(updated.data.preferences).toEqual({ remindersEnabled: false, milestoneAlerts: true, browserNotifications: true });

    const invalid = await user.client.call(preferencesRoute.PATCH, { method: "PATCH", path: "/api/notifications/preferences", body: { remindersEnabled: "yes" } });
    expect(invalid.status).toBe(400);
  });
});
