import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { Errors } from "@/lib/api/errors";
import type { SessionUser } from "@/lib/auth/session";
import { fromDbDate, toDbDate, todayInTimeZone, type DateString } from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { isAvailableOn, isScheduledOn } from "@/lib/schedule";
import { summarizeDay, weeklyProgress, type DoneMap, type StatHabit } from "@/lib/stats";
import { calculateStreak } from "@/lib/streaks";
import {
  habitInputSchema,
  type HabitInput,
  type HabitListQuery,
  type HabitUpdateInput,
} from "@/shared/validations/habit";
import { loadDoneMap, loadHabit, loadHabits, toHabitDTO, type LoadedHabit } from "@/services/habit-data";
import type { DailyDTO, HabitDTO, HabitStateDTO } from "@/shared/api-types";

const MAX_HABITS_PER_USER = 200;

export function userToday(user: Pick<SessionUser, "timeZone">, now = new Date()): DateString {
  return todayInTimeZone(user.timeZone, now);
}

/** Combine habits with their state on `date`: completion row, weekly progress and streak. */
export async function buildHabitStates(
  user: SessionUser,
  habits: LoadedHabit[],
  date: DateString,
  today: DateString,
  /** Pass an already loaded (full-history) map to avoid a second query. */
  preloadedDone?: DoneMap,
): Promise<HabitStateDTO[]> {
  if (habits.length === 0) return [];
  const ids = habits.map((h) => h.row.id);
  const [done, dayRows] = await Promise.all([
    preloadedDone ?? loadDoneMap(ids),
    prisma.habitCompletion.findMany({ where: { habitId: { in: ids }, completionDate: toDbDate(date) } }),
  ]);
  const byHabit = new Map(dayRows.map((row) => [row.habitId, row]));

  return habits.map(({ row, schedule }) => {
    const completion = byHabit.get(row.id);
    const doneDates = done.get(row.id) ?? new Set<DateString>();
    const streak = calculateStreak(schedule, doneDates, today, user.weekStartsOn);
    const state: HabitStateDTO["state"] = completion?.completedAt
      ? "done"
      : completion && (completion.progressValue ?? 0) > 0
        ? "partial"
        : "pending";

    return {
      ...toHabitDTO(row),
      date,
      scheduledOnDate: isScheduledOn(schedule, date),
      availableOnDate: isAvailableOn(schedule, date),
      state,
      progressValue: completion?.progressValue ?? null,
      notes: completion?.notes ?? null,
      completedAt: completion?.completedAt?.toISOString() ?? null,
      weekly:
        schedule.scheduleType === "WEEKLY"
          ? (({ count, target }) => ({ count, target }))(weeklyProgress(schedule, doneDates, date, user.weekStartsOn))
          : null,
      streak: {
        unit: streak.unit,
        current: row.archivedAt ? 0 : streak.current,
        longest: streak.longest,
      },
    };
  });
}

const STATE_ORDER = { pending: 0, partial: 1, done: 2 } as const;

export async function listHabits(user: SessionUser, query: HabitListQuery): Promise<HabitStateDTO[]> {
  const today = userToday(user);
  const date = query.date ?? today;

  const where: Prisma.HabitWhereInput = {
    ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.status === "archived" ? { archivedAt: { not: null } } : {}),
    ...(["active", "completed", "incomplete"].includes(query.status) ? { archivedAt: null } : {}),
  };

  const habits = await loadHabits(user.id, where);
  let states = await buildHabitStates(user, habits, date, today);

  if (query.status === "completed") states = states.filter((h) => h.state === "done");
  if (query.status === "incomplete") states = states.filter((h) => h.state !== "done" && h.availableOnDate);

  const direction = query.order === "asc" ? 1 : -1;
  states.sort((a, b) => {
    switch (query.sort) {
      case "name":
        return a.name.localeCompare(b.name) * direction;
      case "status":
        return (STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name)) * direction;
      case "created":
        return (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) * direction;
    }
  });
  return states;
}

export async function getHabitOrThrow(user: SessionUser, habitId: string): Promise<LoadedHabit> {
  const habit = await loadHabit(user.id, habitId);
  if (!habit) throw Errors.notFound("Habit");
  return habit;
}

export async function getHabitDTO(user: SessionUser, habitId: string): Promise<HabitDTO> {
  return toHabitDTO((await getHabitOrThrow(user, habitId)).row);
}

/** The daily tracker: every habit that can be logged on `date`, plus the day's summary. */
export async function getDaily(user: SessionUser, date?: DateString): Promise<DailyDTO> {
  const today = userToday(user);
  const day = date ?? today;
  const loaded = await loadHabits(user.id);
  const available = loaded.filter((h) => isAvailableOn(h.schedule, day));
  const habits = await buildHabitStates(user, available, day, today);

  const statHabits: StatHabit[] = loaded.map((h) => ({ id: h.row.id, schedule: h.schedule }));
  const done = await loadDoneMap(
    loaded.map((h) => h.row.id),
    { from: day, to: day },
  );
  const summary = summarizeDay(statHabits, done, day);

  return { date: day, today, isToday: day === today, isFuture: day > today, habits, summary };
}

export async function createHabit(user: SessionUser, input: HabitInput): Promise<HabitDTO> {
  const count = await prisma.habit.count({ where: { userId: user.id } });
  if (count >= MAX_HABITS_PER_USER) throw Errors.conflict(`You can track up to ${MAX_HABITS_PER_USER} habits.`);

  const row = await prisma.habit.create({
    data: { ...input, userId: user.id, startDate: toDbDate(input.startDate) },
  });
  return toHabitDTO(row);
}

export async function updateHabit(user: SessionUser, habitId: string, patch: HabitUpdateInput): Promise<HabitDTO> {
  const { row, schedule } = await getHabitOrThrow(user, habitId);
  const { archived, ...fields } = patch;
  const today = userToday(user);

  let current = row;
  if (Object.keys(fields).length > 0) {
    const existing = toHabitDTO(row);
    const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    const merged = habitInputSchema.parse({
      name: existing.name,
      description: existing.description,
      category: existing.category,
      customCategory: existing.customCategory,
      icon: existing.icon,
      color: existing.color,
      scheduleType: existing.scheduleType,
      scheduledDays: existing.scheduledDays,
      weeklyTarget: existing.weeklyTarget,
      targetValue: existing.targetValue,
      targetUnit: existing.targetUnit,
      reminderTime: existing.reminderTime,
      startDate: existing.startDate,
      ...defined,
    });

    if (merged.startDate > schedule.startDate) {
      const earlier = await prisma.habitCompletion.findFirst({
        where: { habitId, completionDate: { lt: toDbDate(merged.startDate) } },
        select: { id: true },
      });
      if (earlier) {
        throw Errors.conflict("This habit already has completions before that start date.", {
          startDate: "Choose a date on or before your first completion.",
        });
      }
    }

    current = await prisma.habit.update({
      where: { id: habitId },
      data: { ...merged, startDate: toDbDate(merged.startDate) },
      include: { pauses: true },
    });
  }

  if (archived !== undefined && archived !== (current.archivedAt !== null)) {
    await setArchived(current.id, archived, today);
    current = await prisma.habit.findUniqueOrThrow({ where: { id: habitId }, include: { pauses: true } });
  }
  return toHabitDTO(current);
}

/** Archive = open a pause; reactivate = close it. Completion history is never touched. */
async function setArchived(habitId: string, archived: boolean, today: DateString): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (archived) {
      await tx.habit.update({ where: { id: habitId }, data: { archivedAt: new Date() } });
      await tx.habitPause.create({ data: { habitId, startDate: toDbDate(today), endDate: null } });
      return;
    }
    await tx.habit.update({ where: { id: habitId }, data: { archivedAt: null } });
    const open = await tx.habitPause.findMany({ where: { habitId, endDate: null } });
    for (const pause of open) {
      if (fromDbDate(pause.startDate) >= today) await tx.habitPause.delete({ where: { id: pause.id } });
      else await tx.habitPause.update({ where: { id: pause.id }, data: { endDate: toDbDate(today) } });
    }
  });
}

export async function deleteHabit(user: SessionUser, habitId: string): Promise<void> {
  const { count } = await prisma.habit.deleteMany({ where: { id: habitId, userId: user.id } });
  if (count === 0) throw Errors.notFound("Habit");
}
