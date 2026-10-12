import "server-only";
import type { Habit, HabitPause, Prisma } from "@/generated/prisma/client";
import { categoryLabel, type HabitCategoryValue, type ScheduleTypeValue } from "@/shared/habits";
import { fromDbDate, type DateString } from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { describeSchedule, type ScheduleInfo } from "@/lib/schedule";
import type { DoneMap } from "@/lib/stats";
import type { HabitDTO } from "@/shared/api-types";

export type HabitRow = Habit & { pauses: HabitPause[] };

export interface LoadedHabit {
  row: HabitRow;
  schedule: ScheduleInfo;
}

export function toSchedule(row: HabitRow): ScheduleInfo {
  return {
    scheduleType: row.scheduleType as ScheduleTypeValue,
    scheduledDays: row.scheduledDays,
    weeklyTarget: row.weeklyTarget,
    startDate: fromDbDate(row.startDate),
    pauses: row.pauses.map((pause) => ({
      start: fromDbDate(pause.startDate),
      end: pause.endDate ? fromDbDate(pause.endDate) : null,
    })),
  };
}

export function toHabitDTO(row: Habit): HabitDTO {
  const category = row.category as HabitCategoryValue;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category,
    customCategory: row.customCategory,
    categoryLabel: categoryLabel(category, row.customCategory),
    icon: row.icon,
    color: row.color,
    scheduleType: row.scheduleType as ScheduleTypeValue,
    scheduledDays: row.scheduledDays,
    weeklyTarget: row.weeklyTarget,
    scheduleLabel: describeSchedule({
      scheduleType: row.scheduleType as ScheduleTypeValue,
      scheduledDays: row.scheduledDays,
      weeklyTarget: row.weeklyTarget,
    }),
    targetValue: row.targetValue,
    targetUnit: row.targetUnit,
    reminderTime: row.reminderTime,
    startDate: fromDbDate(row.startDate),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    isArchived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** All of a user's habits (optionally narrowed), always scoped to that user. */
export async function loadHabits(userId: string, where: Prisma.HabitWhereInput = {}): Promise<LoadedHabit[]> {
  const rows = await prisma.habit.findMany({
    where: { ...where, userId },
    include: { pauses: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ row, schedule: toSchedule(row) }));
}

export async function loadHabit(userId: string, habitId: string): Promise<LoadedHabit | null> {
  const row = await prisma.habit.findFirst({ where: { id: habitId, userId }, include: { pauses: true } });
  return row ? { row, schedule: toSchedule(row) } : null;
}

/** Days on which each habit counted as done, optionally limited to `[from, to]`. */
export async function loadDoneMap(
  habitIds: string[],
  range: { from?: DateString; to?: DateString } = {},
): Promise<DoneMap> {
  const map: DoneMap = new Map(habitIds.map((id) => [id, new Set<DateString>()]));
  if (habitIds.length === 0) return map;

  const rows = await prisma.habitCompletion.findMany({
    where: {
      habitId: { in: habitIds },
      completedAt: { not: null },
      ...(range.from || range.to
        ? {
            completionDate: {
              ...(range.from ? { gte: new Date(`${range.from}T00:00:00.000Z`) } : {}),
              ...(range.to ? { lte: new Date(`${range.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    },
    select: { habitId: true, completionDate: true },
  });
  for (const row of rows) map.get(row.habitId)?.add(fromDbDate(row.completionDate));
  return map;
}
