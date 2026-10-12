import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { completionPercentage } from "@/shared/completion-rules";
import {
  addDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  fromDbDate,
  monthStart,
  startOfWeek,
  toDbDate,
} from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { isAvailableOn } from "@/lib/schedule";
import { habitRate, summarizeDay, summarizeRange, weeklyProgress, type StatHabit } from "@/lib/stats";
import { calculatePerfectDayStreak, calculateStreak } from "@/lib/streaks";
import { completionInclude, toCompletionDTO } from "@/services/completions";
import { loadDoneMap, loadHabits, toHabitDTO } from "@/services/habit-data";
import { buildHabitStates, getHabitOrThrow, userToday } from "@/services/habits";
import type { CalendarDTO, DashboardDTO, HabitDetailDTO, HabitStateDTO } from "@/shared/api-types";

export async function getDashboard(user: SessionUser): Promise<DashboardDTO> {
  const today = userToday(user);
  const loaded = await loadHabits(user.id);
  const active = loaded.filter((h) => !h.row.archivedAt);
  const done = await loadDoneMap(loaded.map((h) => h.row.id));
  const stat: StatHabit[] = loaded.map((h) => ({ id: h.row.id, schedule: h.schedule }));

  const summary = summarizeDay(stat, done, today);
  const todayAvailable = active.filter((h) => isAvailableOn(h.schedule, today));
  const todayHabits: HabitStateDTO[] = await buildHabitStates(user, todayAvailable, today, today, done);

  const weekStart = startOfWeek(today, user.weekStartsOn);
  const week = summarizeRange(stat, done, weekStart, endOfWeek(today, user.weekStartsOn));
  const elapsed = week.filter((day) => day.date <= today);
  const weekCompleted = elapsed.reduce((sum, day) => sum + day.completed, 0);
  const weekScheduled = elapsed.reduce((sum, day) => sum + day.scheduled, 0);

  const streaks = active.map(({ row, schedule }) => ({
    row,
    streak: calculateStreak(schedule, done.get(row.id) ?? [], today, user.weekStartsOn),
  }));
  const topHabits = streaks
    .sort((a, b) => b.streak.current - a.streak.current || b.streak.longest - a.streak.longest)
    .slice(0, 5)
    .map(({ row, streak }) => ({
      habitId: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon,
      unit: streak.unit,
      current: streak.current,
      longest: streak.longest,
    }));

  const recent = await prisma.habitCompletion.findMany({
    where: { habit: { userId: user.id }, completedAt: { not: null } },
    include: completionInclude,
    orderBy: { completedAt: "desc" },
    take: 8,
  });

  const totalCompletions = [...done.values()].reduce((sum, set) => sum + set.size, 0);

  return {
    date: today,
    user: { name: user.name },
    totals: {
      activeHabits: active.length,
      completedToday: summary.completed,
      scheduledToday: summary.scheduled,
      remainingToday: summary.scheduled - summary.completed,
      percentage: summary.percentage,
    },
    streaks: {
      perfectDay: calculatePerfectDayStreak(
        active.map((h) => ({ id: h.row.id, schedule: h.schedule })),
        done,
        today,
      ),
      topHabits,
    },
    totalCompletions,
    week,
    weekProgress: {
      completed: weekCompleted,
      scheduled: weekScheduled,
      percentage: completionPercentage(weekCompleted, weekScheduled),
    },
    todayHabits,
    recentActivity: recent.map(toCompletionDTO),
  };
}

export async function getStreakOverview(user: SessionUser) {
  const today = userToday(user);
  const loaded = await loadHabits(user.id);
  const done = await loadDoneMap(loaded.map((h) => h.row.id));
  const active = loaded.filter((h) => !h.row.archivedAt);

  const habits = loaded.map(({ row, schedule }) => {
    const streak = calculateStreak(schedule, done.get(row.id) ?? [], today, user.weekStartsOn);
    return {
      habitId: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon,
      isArchived: row.archivedAt !== null,
      unit: streak.unit,
      current: row.archivedAt ? 0 : streak.current,
      longest: streak.longest,
      totalCompletions: streak.totalCompletions,
      lastCompletedOn: streak.lastCompletedOn,
      recentRuns: streak.recentRuns,
    };
  });

  return {
    perfectDay: calculatePerfectDayStreak(
      active.map((h) => ({ id: h.row.id, schedule: h.schedule })),
      done,
      today,
    ),
    habits,
  };
}

export async function getCalendar(user: SessionUser, month: string): Promise<CalendarDTO> {
  const today = userToday(user);
  const from = monthStart(month);
  const to = endOfMonth(from);
  const loaded = await loadHabits(user.id);
  const done = await loadDoneMap(
    loaded.map((h) => h.row.id),
    { from, to },
  );
  const stat: StatHabit[] = loaded.map((h) => ({ id: h.row.id, schedule: h.schedule }));
  const days = summarizeRange(stat, done, from, to).map((day) => ({
    ...day,
    isToday: day.date === today,
    isFuture: day.date > today,
  }));
  return { month, today, weekStartsOn: user.weekStartsOn, days };
}

const toPercent = (rate: number | null) => (rate === null ? null : Math.round(rate * 100));

export async function getHabitDetail(user: SessionUser, habitId: string): Promise<HabitDetailDTO> {
  const { row, schedule } = await getHabitOrThrow(user, habitId);
  const today = userToday(user);
  const done = (await loadDoneMap([habitId])).get(habitId) ?? new Set<string>();
  const streak = calculateStreak(schedule, done, today, user.weekStartsOn);
  const stat: StatHabit = { id: habitId, schedule };

  const from30 = addDays(today, -29);
  const rows = await prisma.habitCompletion.findMany({
    where: { habitId, completionDate: { gte: toDbDate(from30), lte: toDbDate(today) } },
    select: { completionDate: true, completedAt: true, progressValue: true },
  });
  const byDate = new Map(rows.map((r) => [fromDbDate(r.completionDate), r]));

  const recent = eachDay(from30, today).map((date) => {
    const entry = byDate.get(date);
    return {
      date,
      scheduled: isAvailableOn(schedule, date),
      state: entry ? (entry.completedAt ? ("done" as const) : ("partial" as const)) : isAvailableOn(schedule, date) ? ("pending" as const) : ("none" as const),
      progressValue: entry?.progressValue ?? null,
    };
  });

  const rate = (from: string) => toPercent(habitRate(stat, done, from, today, today).rate);

  return {
    habit: toHabitDTO(row),
    streak: {
      unit: streak.unit,
      current: row.archivedAt ? 0 : streak.current,
      longest: streak.longest,
      currentRun: row.archivedAt ? null : streak.currentRun,
      longestRun: streak.longestRun,
      recentRuns: streak.recentRuns,
      totalCompletions: streak.totalCompletions,
      lastCompletedOn: streak.lastCompletedOn,
    },
    consistency: {
      last7: rate(addDays(today, -6)),
      last30: rate(from30),
      allTime: rate(schedule.startDate),
    },
    recent,
    weekly:
      schedule.scheduleType === "WEEKLY"
        ? (({ count, target }) => ({ count, target }))(weeklyProgress(schedule, done, today, user.weekStartsOn))
        : null,
  };
}
