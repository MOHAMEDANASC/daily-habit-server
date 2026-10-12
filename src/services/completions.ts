import "server-only";
import type { HabitCompletion, Prisma } from "@/generated/prisma/client";
import { ApiError, Errors } from "@/lib/api/errors";
import type { SessionUser } from "@/lib/auth/session";
import { resolveProgress } from "@/shared/completion-rules";
import { diffDays, fromDbDate, toDbDate, type DateString } from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { isAvailableOn } from "@/lib/schedule";
import { summarizeRange, type StatHabit } from "@/lib/stats";
import { MAX_RANGE_DAYS } from "@/shared/validations/common";
import type { CompletionBody } from "@/shared/validations/habit";
import { syncGoalsForUser } from "@/services/goals";
import { loadDoneMap, loadHabits } from "@/services/habit-data";
import { buildHabitStates, getHabitOrThrow, userToday } from "@/services/habits";
import { createNotification } from "@/services/notifications";
import type { CompletionDTO, DaySummaryDTO, HabitStateDTO, PageDTO } from "@/shared/api-types";

const STREAK_MILESTONES = new Set([3, 7, 14, 21, 30, 50, 75, 100, 200, 365]);

/** Create or update a day's entry for a habit (check-off, measurable progress and/or notes). */
export async function setCompletion(
  user: SessionUser,
  habitId: string,
  date: DateString,
  body: CompletionBody,
): Promise<HabitStateDTO> {
  const { row, schedule } = await getHabitOrThrow(user, habitId);
  const today = userToday(user);

  if (date > today) {
    throw new ApiError(422, "FUTURE_DATE", "You can't log a day that hasn't happened yet.", { date: "Pick today or an earlier day." });
  }
  if (row.archivedAt) throw Errors.conflict("This habit is archived. Reactivate it to log progress.");
  if (!isAvailableOn(schedule, date)) {
    throw new ApiError(422, "NOT_SCHEDULED", "This habit isn't scheduled on that day.", { date: "Not scheduled on this day." });
  }

  const input = body ?? {};
  const resolved = resolveProgress({
    targetValue: row.targetValue,
    progressValue: input.progressValue,
    completed: input.completed,
  });
  const completionDate = toDbDate(date);
  const where = { habitId_completionDate: { habitId, completionDate } };
  const existing = await prisma.habitCompletion.findUnique({ where });
  const notes = input.notes === undefined ? (existing?.notes ?? null) : input.notes;

  if (!resolved.done && resolved.progressValue === null && !notes) {
    await prisma.habitCompletion.deleteMany({ where: { habitId, completionDate } });
  } else {
    await prisma.habitCompletion.upsert({
      where,
      create: {
        habitId,
        completionDate,
        progressValue: resolved.progressValue,
        notes,
        completedAt: resolved.done ? new Date() : null,
      },
      update: {
        progressValue: resolved.progressValue,
        notes,
        completedAt: resolved.done ? (existing?.completedAt ?? new Date()) : null,
      },
    });
  }

  await syncGoalsForUser(user);
  const [state] = await buildHabitStates(user, [{ row, schedule }], date, today);
  if (resolved.done && date === today) await notifyStreakMilestone(user, state);
  return state;
}

/** Remove a day's entry entirely. Idempotent. */
export async function undoCompletion(user: SessionUser, habitId: string, date: DateString): Promise<HabitStateDTO> {
  const loaded = await getHabitOrThrow(user, habitId);
  await prisma.habitCompletion.deleteMany({ where: { habitId, completionDate: toDbDate(date) } });
  await syncGoalsForUser(user);
  const [state] = await buildHabitStates(user, [loaded], date, userToday(user));
  return state;
}

async function notifyStreakMilestone(user: SessionUser, state: HabitStateDTO): Promise<void> {
  const { current, unit } = state.streak;
  if (!user.milestoneAlerts || !STREAK_MILESTONES.has(current)) return;
  await createNotification(user.id, {
    type: "STREAK",
    title: `${current}-${unit} streak!`,
    message: `You've kept "${state.name}" going for ${current} ${unit}${current === 1 ? "" : "s"} in a row.`,
    href: `/habits/${state.id}`,
    dedupeKey: `streak:${state.id}:${unit}:${current}:${state.date}`,
  });
}

type CompletionWithHabit = HabitCompletion & {
  habit: { name: string; color: string; icon: string; targetUnit: string | null };
};

export function toCompletionDTO(row: CompletionWithHabit): CompletionDTO {
  return {
    id: row.id,
    habitId: row.habitId,
    habitName: row.habit.name,
    habitColor: row.habit.color,
    habitIcon: row.habit.icon,
    date: fromDbDate(row.completionDate),
    completed: row.completedAt !== null,
    completedAt: row.completedAt?.toISOString() ?? null,
    progressValue: row.progressValue,
    notes: row.notes,
    targetUnit: row.habit.targetUnit,
  };
}

export const completionInclude = {
  habit: { select: { name: true, color: true, icon: true, targetUnit: true } },
} satisfies Prisma.HabitCompletionInclude;

/** Paginated completion history, newest first. */
export async function listCompletions(
  user: SessionUser,
  query: { from?: DateString; to?: DateString; habitId?: string; page: number; pageSize: number },
): Promise<PageDTO<CompletionDTO>> {
  const where: Prisma.HabitCompletionWhereInput = {
    habit: { userId: user.id },
    ...(query.habitId ? { habitId: query.habitId } : {}),
    ...(query.from || query.to
      ? {
          completionDate: {
            ...(query.from ? { gte: toDbDate(query.from) } : {}),
            ...(query.to ? { lte: toDbDate(query.to) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.habitCompletion.count({ where }),
    prisma.habitCompletion.findMany({
      where,
      include: completionInclude,
      orderBy: [{ completionDate: "desc" }, { updatedAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toCompletionDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
    hasMore: query.page * query.pageSize < total,
  };
}

/** Per-day completion summaries across a date range. */
export async function getCompletionSummaries(user: SessionUser, from: DateString, to: DateString): Promise<DaySummaryDTO[]> {
  if (from > to) throw Errors.badRequest("The start date must be on or before the end date.");
  if (diffDays(from, to) > MAX_RANGE_DAYS) throw Errors.badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);

  const habits = await loadHabits(user.id);
  const stat: StatHabit[] = habits.map((h) => ({ id: h.row.id, schedule: h.schedule }));
  const done = await loadDoneMap(
    habits.map((h) => h.row.id),
    { from, to },
  );
  return summarizeRange(stat, done, from, to);
}
