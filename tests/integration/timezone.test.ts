import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../helpers/api-client";
import { complete, createHabit, signUp } from "../helpers/fixtures";
import * as cronRoute from "@/app/api/cron/reminders/route";
import * as dailyRoute from "@/app/api/daily/route";
import * as habitRoute from "@/app/api/habits/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import { prisma } from "@/lib/prisma";

/** Only `Date` is faked, so timers and the database driver keep working. */
const setNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

afterEach(() => vi.useRealTimers());

const daily = (user: Awaited<ReturnType<typeof signUp>>) => user.client.call(dailyRoute.GET, { path: "/api/daily" });

describe("each user's day follows their own time zone", () => {
  it("resolves a different current day for the same instant", async () => {
    setNow("2024-06-01T20:00:00Z");
    const utc = await signUp({ timeZone: "UTC" });
    const auckland = await signUp({ timeZone: "Pacific/Auckland" });
    const la = await signUp({ timeZone: "America/Los_Angeles" });

    expect((await daily(utc)).data.today).toBe("2024-06-01");
    expect((await daily(auckland)).data.today).toBe("2024-06-02");
    expect((await daily(la)).data.today).toBe("2024-06-01");
  });

  it("treats the user's tomorrow as the future and the user's today as loggable", async () => {
    setNow("2024-06-01T20:00:00Z");
    const utc = await signUp({ timeZone: "UTC" });
    const auckland = await signUp({ timeZone: "Pacific/Auckland" });
    const utcHabit = await createHabit(utc, { startDate: "2024-05-01" });
    const nzHabit = await createHabit(auckland, { startDate: "2024-05-01" });

    // 2024-06-02 has already begun in Auckland but not yet in UTC.
    expect((await complete(utc, utcHabit.id, "2024-06-02")).status).toBe(422);
    expect((await complete(auckland, nzHabit.id, "2024-06-02")).status).toBe(200);
    expect((await complete(auckland, nzHabit.id, "2024-06-03")).status).toBe(422);

    const stored = await prisma.habitCompletion.findFirstOrThrow({ where: { habitId: nzHabit.id } });
    expect(stored.completionDate.toISOString()).toBe("2024-06-02T00:00:00.000Z");
  });

  it("moves the daily boundary exactly at local midnight and keeps streaks across it", async () => {
    // Asia/Kolkata is UTC+5:30, so local midnight is 18:30 UTC.
    setNow("2024-06-01T18:29:59Z");
    const user = await signUp({ timeZone: "Asia/Kolkata" });
    const habit = await createHabit(user, { startDate: "2024-05-30" });
    for (const date of ["2024-05-30", "2024-05-31", "2024-06-01"]) expect((await complete(user, habit.id, date)).status).toBe(200);

    const detail = () => user.client.call(habitRoute.GET, { path: `/api/habits/${habit.id}`, params: { id: habit.id } });
    expect((await daily(user)).data.today).toBe("2024-06-01");
    expect((await detail()).data.streak.current).toBe(3);

    // One second later it is 2024-06-02 locally: today is open, so the streak is not lost yet.
    setNow("2024-06-01T18:30:00Z");
    expect((await daily(user)).data.today).toBe("2024-06-02");
    expect((await detail()).data.streak.current).toBe(3);

    // A whole local day passes without completing 2024-06-02: the streak breaks.
    setNow("2024-06-02T18:30:00Z");
    expect((await daily(user)).data.today).toBe("2024-06-03");
    const broken = (await detail()).data.streak;
    expect(broken.current).toBe(0);
    expect(broken.longest).toBe(3);
  });

  it("keeps the streak when the user catches up on yesterday", async () => {
    setNow("2024-06-03T01:00:00Z");
    const user = await signUp({ timeZone: "America/New_York" }); // 2024-06-02 21:00 local
    const habit = await createHabit(user, { startDate: "2024-05-30" });
    for (const date of ["2024-05-30", "2024-05-31", "2024-06-01", "2024-06-02"]) await complete(user, habit.id, date);
    const detail = await user.client.call(habitRoute.GET, { path: `/api/habits/${habit.id}`, params: { id: habit.id } });
    expect(detail.data.streak.current).toBe(4);
  });
});

describe("reminders honour the user's local time", () => {
  const cron = (secret?: string) =>
    new ApiClient().call(cronRoute.POST, {
      method: "POST",
      path: "/api/cron/reminders",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  const secret = "test-cron-secret-0123456789abcdef";

  it("creates a reminder once the local reminder time has passed, once per day", async () => {
    setNow("2024-06-01T02:00:00Z"); // 07:30 in Kolkata
    const user = await signUp({ timeZone: "Asia/Kolkata" });
    await createHabit(user, { name: "Meditate", reminderTime: "08:00", startDate: "2024-05-01" });

    expect((await cron(secret)).data).toMatchObject({ users: 1, created: 0 });

    setNow("2024-06-01T02:30:00Z"); // 08:00 in Kolkata
    expect((await cron(secret)).data).toMatchObject({ users: 1, created: 1 });
    expect((await cron(secret)).data).toMatchObject({ users: 1, created: 0 }); // idempotent

    const list = await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    const reminders = list.data.items.filter((n: { type: string }) => n.type === "REMINDER");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toBe("Time for Meditate");

    setNow("2024-06-02T02:30:00Z"); // next local day
    expect((await cron(secret)).data.created).toBe(1);
  });

  it("does not remind about habits that are already done or not scheduled today", async () => {
    setNow("2024-06-03T10:00:00Z"); // Monday
    const user = await signUp({ timeZone: "UTC" });
    const done = await createHabit(user, { name: "Done already", reminderTime: "08:00", startDate: "2024-05-01" });
    await createHabit(user, { name: "Tuesdays only", reminderTime: "08:00", scheduleType: "SELECTED_DAYS", scheduledDays: [2], startDate: "2024-05-01" });
    await createHabit(user, { name: "Still to do", reminderTime: "08:00", startDate: "2024-05-01" });
    await complete(user, done.id, "2024-06-03");

    expect((await cron(secret)).data.created).toBe(1);
    const list = await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    expect(list.data.items.filter((n: { type: string }) => n.type === "REMINDER").map((n: { title: string }) => n.title)).toEqual([
      "Time for Still to do",
    ]);
  });

  it("is lazily evaluated when the user opens their notifications and respects the reminder preference", async () => {
    setNow("2024-06-03T10:00:00Z");
    const user = await signUp({ timeZone: "UTC" });
    await createHabit(user, { name: "Stretch", reminderTime: "09:00", startDate: "2024-05-01" });
    const list = await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    expect(list.data.items.some((n: { type: string }) => n.type === "REMINDER")).toBe(true);

    await prisma.notification.deleteMany({ where: { type: "REMINDER" } });
    await prisma.user.update({ where: { id: user.id }, data: { remindersEnabled: false } });
    await user.client.call(notificationsRoute.GET, { path: "/api/notifications" });
    expect(await prisma.notification.count({ where: { type: "REMINDER" } })).toBe(0);
  });

  it("only lets the scheduler call the cron endpoint with the shared secret", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong-secret-wrong-secret-0000")).status).toBe(401);
    expect((await cron(secret)).status).toBe(200);
  });
});
