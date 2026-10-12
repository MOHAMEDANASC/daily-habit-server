import "server-only";
import { categoryLabel, type HabitCategoryValue } from "@/shared/habits";
import type { SessionUser } from "@/lib/auth/session";
import {
  addDays,
  diffDays,
  formatDate,
  minDate,
  startOfWeek,
  type DateString,
} from "@/shared/dates";
import { habitRate, summarizeRange, type StatHabit } from "@/lib/stats";
import { calculateStreak } from "@/lib/streaks";
import type { RangeQuery } from "@/lib/validations/misc";
import { loadDoneMap, loadHabits } from "@/services/habit-data";
import { userToday } from "@/services/habits";
import type { AnalyticsDTO, CategoryReportDTO, DaySummaryDTO, HabitReportDTO, TrendPoint } from "@/shared/api-types";

const toPercent = (rate: number | null) => (rate === null ? null : Math.round(rate * 100));
const MIN_EXPECTED_FOR_RANKING = 3;

function totalsFor(days: DaySummaryDTO[]) {
  const scheduled = days.reduce((sum, d) => sum + d.scheduled, 0);
  const completed = days.reduce((sum, d) => sum + d.completed, 0);
  return {
    completed,
    scheduled,
    rate: scheduled > 0 ? Math.round((completed / scheduled) * 100) : null,
    perfectDays: days.filter((d) => d.status === "complete").length,
    activeDays: days.filter((d) => d.scheduled > 0).length,
  };
}

function bucket(
  days: DaySummaryDTO[],
  keyOf: (date: DateString) => DateString,
  labelOf: (date: DateString) => string,
): TrendPoint[] {
  const groups = new Map<DateString, { completed: number; scheduled: number }>();
  for (const day of days) {
    const key = keyOf(day.date);
    const group = groups.get(key) ?? { completed: 0, scheduled: 0 };
    group.completed += day.completed;
    group.scheduled += day.scheduled;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([date, g]) => ({
    date,
    label: labelOf(date),
    completed: g.completed,
    scheduled: g.scheduled,
    percentage: g.scheduled > 0 ? Math.round((g.completed / g.scheduled) * 100) : 0,
  }));
}

export async function getAnalytics(user: SessionUser, query: RangeQuery): Promise<AnalyticsDTO> {
  const today = userToday(user);
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -29);
  const length = diffDays(from, to) + 1;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(length - 1));

  const loaded = await loadHabits(user.id, {
    ...(query.habitId ? { id: query.habitId } : {}),
    ...(query.category ? { category: query.category } : {}),
  });
  const done = await loadDoneMap(loaded.map((h) => h.row.id));
  const stat: StatHabit[] = loaded.map((h) => ({ id: h.row.id, schedule: h.schedule }));

  // Days after today have not happened yet, so they never count for or against the user.
  const effectiveTo = minDate(to, today);
  const days = from <= effectiveTo ? summarizeRange(stat, done, from, effectiveTo) : [];
  const previousEffectiveTo = minDate(previousTo, today);
  const previousDays = previousFrom <= previousEffectiveTo ? summarizeRange(stat, done, previousFrom, previousEffectiveTo) : [];
  const current = totalsFor(days);
  const previous = totalsFor(previousDays);

  const ws = user.weekStartsOn;
  const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const series = {
    day: bucket(days, (d) => d, (d) => formatDate(d, short)),
    week: bucket(days, (d) => startOfWeek(d, ws), (d) => formatDate(d, short)),
    month: bucket(
      days,
      (d) => `${d.slice(0, 7)}-01`,
      (d) => formatDate(d, { month: "short", year: "numeric" }),
    ),
  };

  // Running total of completed habit-days, anchored on everything completed before the range.
  let running = 0;
  for (const set of done.values()) for (const date of set) if (date < from) running++;
  const cumulative = days.map((day) => {
    running += day.completed;
    return { date: day.date, total: running };
  });

  const habits: HabitReportDTO[] = loaded.map(({ row, schedule }) => {
    const doneDates = done.get(row.id) ?? new Set<string>();
    const rate = habitRate({ id: row.id, schedule }, doneDates, from, to, today);
    const prevRate = habitRate({ id: row.id, schedule }, doneDates, previousFrom, previousTo, today);
    const streak = calculateStreak(schedule, doneDates, today, ws);
    const category = row.category as HabitCategoryValue;
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon,
      category,
      categoryLabel: categoryLabel(category, row.customCategory),
      isArchived: row.archivedAt !== null,
      rate: toPercent(rate.rate),
      previousRate: toPercent(prevRate.rate),
      expected: Math.round(rate.expected * 10) / 10,
      actual: rate.actual,
      streak: { unit: streak.unit, current: row.archivedAt ? 0 : streak.current, longest: streak.longest },
    };
  });

  const categoryMap = new Map<HabitCategoryValue, CategoryReportDTO & { capped: number }>();
  for (const habit of habits) {
    if (habit.expected <= 0) continue;
    const entry =
      categoryMap.get(habit.category) ??
      { category: habit.category, label: habit.categoryLabel, habits: 0, rate: null, actual: 0, expected: 0, capped: 0 };
    entry.habits += 1;
    entry.actual += habit.actual;
    entry.expected += habit.expected;
    entry.capped += Math.min(habit.actual, habit.expected);
    categoryMap.set(habit.category, entry);
  }
  const categories: CategoryReportDTO[] = [...categoryMap.values()]
    .map(({ capped, ...entry }) => ({
      ...entry,
      rate: entry.expected > 0 ? Math.round((capped / entry.expected) * 100) : null,
      expected: Math.round(entry.expected * 10) / 10,
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  const rankable = habits.filter((h) => !h.isArchived && h.rate !== null && h.expected >= MIN_EXPECTED_FOR_RANKING);
  const best = [...rankable]
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.actual - a.actual)
    .filter((h) => (h.rate ?? 0) >= 50)
    .slice(0, 3);
  const bestIds = new Set(best.map((h) => h.id));
  const needsImprovement = [...rankable]
    .filter((h) => (h.rate ?? 0) < 80 && !bestIds.has(h.id))
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
    .slice(0, 3);

  return {
    range: { from, to, days: length },
    previous: { from: previousFrom, to: previousTo },
    hasEnoughData: loaded.length > 0 && current.activeDays >= 3,
    totals: {
      completions: current.completed,
      previousCompletions: previous.completed,
      rate: current.rate,
      previousRate: previous.rate,
      perfectDays: current.perfectDays,
      activeDays: current.activeDays,
    },
    series,
    cumulative,
    habits,
    categories,
    best,
    needsImprovement,
  };
}
