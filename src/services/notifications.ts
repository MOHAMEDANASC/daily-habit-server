import "server-only";
import type { Notification, Prisma } from "@/generated/prisma/client";
import { Errors } from "@/lib/api/errors";
import type { SessionUser } from "@/lib/auth/session";
import { addDays, localTimeInTimeZone, todayInTimeZone } from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { isAvailableOn } from "@/lib/schedule";
import { weeklyProgress } from "@/lib/stats";
import { loadDoneMap, loadHabits } from "@/services/habit-data";
import type { NotificationDTO, NotificationPageDTO, NotificationTypeValue } from "@/shared/api-types";

export interface NewNotification {
  type: NotificationTypeValue;
  title: string;
  message: string;
  href?: string | null;
  /** Re-creating a notification with the same key for the same user is a no-op. */
  dedupeKey?: string;
}

export async function createNotification(userId: string, input: NewNotification): Promise<boolean> {
  const { count } = await prisma.notification.createMany({
    data: [{ userId, ...input, href: input.href ?? null }],
    skipDuplicates: true,
  });
  return count > 0;
}

function toDTO(row: Notification): NotificationDTO {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type as NotificationTypeValue,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  user: Pick<SessionUser, "id">,
  query: { status: "all" | "unread"; page: number; pageSize: number },
): Promise<NotificationPageDTO> {
  const base: Prisma.NotificationWhereInput = { userId: user.id, dismissedAt: null };
  const where: Prisma.NotificationWhereInput = query.status === "unread" ? { ...base, readAt: null } : base;

  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...base, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
    hasMore: query.page * query.pageSize < total,
    unreadCount,
  };
}

export async function updateNotification(
  user: Pick<SessionUser, "id">,
  id: string,
  patch: { read?: boolean; dismissed?: boolean },
): Promise<NotificationDTO> {
  const existing = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw Errors.notFound("Notification");

  const now = new Date();
  const updated = await prisma.notification.update({
    where: { id },
    data: {
      ...(patch.read === undefined ? {} : { readAt: patch.read ? (existing.readAt ?? now) : null }),
      ...(patch.dismissed === undefined
        ? {}
        : { dismissedAt: patch.dismissed ? now : null, ...(patch.dismissed ? { readAt: existing.readAt ?? now } : {}) }),
    },
  });
  return toDTO(updated);
}

export async function markAllRead(user: Pick<SessionUser, "id">): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, dismissedAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

type ReminderUser = Pick<SessionUser, "id" | "timeZone" | "remindersEnabled" | "weekStartsOn">;

/**
 * Create today's due reminders for one user: habits that have a reminder time which has already
 * passed in the user's time zone, are available today and are not finished yet. Idempotent per
 * habit and day, so it is safe to call from many places (page loads and the cron job).
 */
export async function generateRemindersForUser(user: ReminderUser, now = new Date()): Promise<number> {
  if (!user.remindersEnabled) return 0;

  const habits = await loadHabits(user.id, { archivedAt: null, reminderTime: { not: null } });
  if (habits.length === 0) return 0;

  const today = todayInTimeZone(user.timeZone, now);
  const time = localTimeInTimeZone(user.timeZone, now);
  const due = habits.filter((h) => (h.row.reminderTime ?? "99:99") <= time && isAvailableOn(h.schedule, today));
  if (due.length === 0) return 0;

  const done = await loadDoneMap(
    due.map((h) => h.row.id),
    { from: addDays(today, -7), to: today },
  );

  const pending = due.filter(({ row, schedule }) => {
    const doneDates = done.get(row.id) ?? new Set<string>();
    if (doneDates.has(today)) return false;
    if (schedule.scheduleType === "WEEKLY") {
      const { count, target } = weeklyProgress(schedule, doneDates, today, user.weekStartsOn);
      return count < target;
    }
    return true;
  });
  if (pending.length === 0) return 0;

  const { count } = await prisma.notification.createMany({
    data: pending.map(({ row }) => ({
      userId: user.id,
      type: "REMINDER" as const,
      title: `Time for ${row.name}`,
      message: row.targetValue
        ? `Your goal today: ${row.targetValue}${row.targetUnit ? ` ${row.targetUnit}` : ""}.`
        : "A small step today keeps your streak going.",
      href: "/tracker",
      dedupeKey: `reminder:${row.id}:${today}`,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** Scheduled job entry point: evaluate reminders for every user that has any configured. */
export async function runReminderJob(now = new Date()): Promise<{ users: number; created: number }> {
  const users = await prisma.user.findMany({
    where: { remindersEnabled: true, habits: { some: { archivedAt: null, reminderTime: { not: null } } } },
    select: { id: true, timeZone: true, remindersEnabled: true, weekStartsOn: true },
  });

  let created = 0;
  const BATCH = 10;
  for (let i = 0; i < users.length; i += BATCH) {
    const results = await Promise.all(users.slice(i, i + BATCH).map((user) => generateRemindersForUser(user, now)));
    created += results.reduce((sum, n) => sum + n, 0);
  }
  return { users: users.length, created };
}
