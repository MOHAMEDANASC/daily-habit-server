import "server-only";
import type { Goal, Prisma } from "@/generated/prisma/client";
import { Errors } from "@/lib/api/errors";
import type { SessionUser } from "@/lib/auth/session";
import { diffDays, fromDbDate, maxDate, minDate, toDbDate, todayInTimeZone, type DateString } from "@/shared/dates";
import { prisma } from "@/lib/prisma";
import { calculateStreak } from "@/lib/streaks";
import { goalInputSchema, type GoalInput, type GoalUpdateInput } from "@/shared/validations/goal";
import { loadDoneMap, loadHabits, type LoadedHabit } from "@/services/habit-data";
import { createNotification } from "@/services/notifications";
import type { GoalDTO, GoalMetricValue, GoalMilestoneDTO, GoalStatusValue } from "@/shared/api-types";

const MAX_GOALS_PER_USER = 100;
const MILESTONE_PERCENTS = [25, 50, 75, 100];

interface Evaluation {
  currentValue: number;
  /** Date on which the running total first reached `value` (null when it has not). */
  reachedOn: (value: number) => DateString | null;
}

interface GoalData {
  habits: Map<string, LoadedHabit>;
  done: Map<string, Set<DateString>>;
  quantities: Map<string, Array<{ date: DateString; value: number }>>;
  today: DateString;
  weekStartsOn: number;
}

async function loadGoalData(user: SessionUser, goals: Goal[]): Promise<GoalData> {
  const loaded = await loadHabits(user.id);
  const habits = new Map(loaded.map((h) => [h.row.id, h]));
  const done = await loadDoneMap([...habits.keys()]);

  const quantityHabitIds = [...new Set(goals.filter((g) => g.metric === "QUANTITY" && g.habitId).map((g) => g.habitId as string))];
  const quantities = new Map<string, Array<{ date: DateString; value: number }>>();
  if (quantityHabitIds.length > 0) {
    const rows = await prisma.habitCompletion.findMany({
      where: { habitId: { in: quantityHabitIds }, progressValue: { not: null } },
      select: { habitId: true, completionDate: true, progressValue: true },
      orderBy: { completionDate: "asc" },
    });
    for (const row of rows) {
      const list = quantities.get(row.habitId) ?? [];
      list.push({ date: fromDbDate(row.completionDate), value: row.progressValue ?? 0 });
      quantities.set(row.habitId, list);
    }
  }
  return { habits, done, quantities, today: todayInTimeZone(user.timeZone), weekStartsOn: user.weekStartsOn };
}

function evaluate(goal: Goal, data: GoalData): Evaluation {
  const start = fromDbDate(goal.startDate);
  const end = goal.targetDate ? fromDbDate(goal.targetDate) : null;
  const windowEnd = end ? minDate(end, data.today) : data.today;

  switch (goal.metric as GoalMetricValue) {
    case "COMPLETIONS": {
      const sources = goal.habitId ? [goal.habitId] : [...data.habits.keys()];
      const dates = sources
        .flatMap((id) => [...(data.done.get(id) ?? [])])
        .filter((date) => date >= start && date <= windowEnd)
        .sort();
      return { currentValue: dates.length, reachedOn: (value) => dates[Math.ceil(value) - 1] ?? null };
    }
    case "STREAK": {
      const habit = goal.habitId ? data.habits.get(goal.habitId) : undefined;
      if (!habit) return { currentValue: 0, reachedOn: () => null };
      const schedule = { ...habit.schedule, startDate: maxDate(habit.schedule.startDate, start) };
      const streak = calculateStreak(schedule, data.done.get(habit.row.id) ?? [], windowEnd, data.weekStartsOn);
      return { currentValue: streak.longest, reachedOn: (value) => streak.firstReached.get(Math.ceil(value)) ?? null };
    }
    case "QUANTITY": {
      const entries = (goal.habitId ? (data.quantities.get(goal.habitId) ?? []) : []).filter(
        (entry) => entry.date >= start && entry.date <= windowEnd,
      );
      const total = entries.reduce((sum, entry) => sum + entry.value, 0);
      return {
        currentValue: Math.round(total * 100) / 100,
        reachedOn: (value) => {
          let running = 0;
          for (const entry of entries) {
            running += entry.value;
            if (running >= value) return entry.date;
          }
          return null;
        },
      };
    }
  }
}

function unitLabelFor(goal: Goal, habit: LoadedHabit | undefined): string {
  switch (goal.metric as GoalMetricValue) {
    case "COMPLETIONS":
      return "completions";
    case "STREAK":
      return habit?.schedule.scheduleType === "WEEKLY" ? "weeks in a row" : "days in a row";
    case "QUANTITY":
      return habit?.row.targetUnit ?? "total";
  }
}

function toGoalDTO(goal: Goal, data: GoalData, evaluation: Evaluation, status: GoalStatusValue, completedAt: Date | null): GoalDTO {
  const habit = goal.habitId ? data.habits.get(goal.habitId) : undefined;
  const target = goal.targetValue;
  const targetDate = goal.targetDate ? fromDbDate(goal.targetDate) : null;

  const milestones: GoalMilestoneDTO[] = MILESTONE_PERCENTS.map((percent) => {
    const value = Math.round(((target * percent) / 100) * 100) / 100;
    const reached = evaluation.currentValue >= value;
    return { percent, value, reached, reachedOn: reached ? evaluation.reachedOn(value) : null };
  });

  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    metric: goal.metric as GoalMetricValue,
    habit: habit
      ? { id: habit.row.id, name: habit.row.name, color: habit.row.color, icon: habit.row.icon, targetUnit: habit.row.targetUnit }
      : null,
    targetValue: target,
    currentValue: evaluation.currentValue,
    progress: Math.min(1, evaluation.currentValue / target),
    unitLabel: unitLabelFor(goal, habit),
    startDate: fromDbDate(goal.startDate),
    targetDate,
    status,
    completedAt: completedAt?.toISOString() ?? null,
    isOverdue: status === "ACTIVE" && targetDate !== null && data.today > targetDate,
    daysLeft: targetDate ? diffDays(data.today, targetDate) : null,
    milestones,
  };
}

/** Evaluate goals, persist ACTIVE ⇄ COMPLETED transitions and send the "goal reached" notification. */
async function evaluateAndSync(user: SessionUser, goals: Goal[]): Promise<GoalDTO[]> {
  if (goals.length === 0) return [];
  const data = await loadGoalData(user, goals);

  const results: GoalDTO[] = [];
  for (const goal of goals) {
    const evaluation = evaluate(goal, data);
    let status = goal.status as GoalStatusValue;
    let completedAt = goal.completedAt;

    if (status === "ACTIVE" && evaluation.currentValue >= goal.targetValue) {
      status = "COMPLETED";
      completedAt = new Date();
      await prisma.goal.update({ where: { id: goal.id }, data: { status, completedAt } });
      if (user.milestoneAlerts) {
        await createNotification(user.id, {
          type: "MILESTONE",
          title: "Goal reached 🎉",
          message: `You completed your goal "${goal.title}".`,
          href: "/goals",
          dedupeKey: `goal:${goal.id}:completed`,
        });
      }
    } else if (status === "COMPLETED" && evaluation.currentValue < goal.targetValue) {
      status = "ACTIVE";
      completedAt = null;
      await prisma.goal.update({ where: { id: goal.id }, data: { status, completedAt } });
    }
    results.push(toGoalDTO(goal, data, evaluation, status, completedAt));
  }
  return results;
}

/** Re-evaluate every non-archived goal; called after completions change. */
export async function syncGoalsForUser(user: SessionUser): Promise<void> {
  const goals = await prisma.goal.findMany({ where: { userId: user.id, status: { in: ["ACTIVE", "COMPLETED"] } } });
  await evaluateAndSync(user, goals);
}

export async function listGoals(user: SessionUser, status: GoalStatusValue | "all" = "all"): Promise<GoalDTO[]> {
  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }],
  });
  const evaluated = await evaluateAndSync(user, goals);
  const order: Record<GoalStatusValue, number> = { ACTIVE: 0, COMPLETED: 1, ARCHIVED: 2 };
  return evaluated
    .filter((goal) => status === "all" || goal.status === status)
    .sort((a, b) => order[a.status] - order[b.status]);
}

async function getOwnedGoal(user: SessionUser, id: string): Promise<Goal> {
  const goal = await prisma.goal.findFirst({ where: { id, userId: user.id } });
  if (!goal) throw Errors.notFound("Goal");
  return goal;
}

export async function getGoal(user: SessionUser, id: string): Promise<GoalDTO> {
  const goal = await getOwnedGoal(user, id);
  return (await evaluateAndSync(user, [goal]))[0];
}

async function assertHabitUsable(user: SessionUser, input: GoalInput): Promise<void> {
  if (!input.habitId) return;
  const habit = await prisma.habit.findFirst({ where: { id: input.habitId, userId: user.id } });
  if (!habit) throw Errors.badRequest("Choose one of your habits.", { habitId: "That habit does not exist." });
  if (input.metric === "QUANTITY" && !habit.targetValue) {
    throw Errors.badRequest("Quantity goals need a habit with a measurable target.", {
      habitId: "This habit has no daily quantity target.",
    });
  }
}

export async function createGoal(user: SessionUser, input: GoalInput): Promise<GoalDTO> {
  if ((await prisma.goal.count({ where: { userId: user.id } })) >= MAX_GOALS_PER_USER) {
    throw Errors.conflict(`You can keep up to ${MAX_GOALS_PER_USER} goals.`);
  }
  await assertHabitUsable(user, input);
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      habitId: input.habitId,
      title: input.title,
      description: input.description,
      metric: input.metric,
      targetValue: input.targetValue,
      startDate: toDbDate(input.startDate),
      targetDate: input.targetDate ? toDbDate(input.targetDate) : null,
    },
  });
  return (await evaluateAndSync(user, [goal]))[0];
}

export async function updateGoal(user: SessionUser, id: string, patch: GoalUpdateInput): Promise<GoalDTO> {
  const existing = await getOwnedGoal(user, id);
  const { status, ...fields } = patch;
  const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

  const merged = goalInputSchema.parse({
    title: existing.title,
    description: existing.description,
    metric: existing.metric,
    habitId: existing.habitId,
    targetValue: existing.targetValue,
    startDate: fromDbDate(existing.startDate),
    targetDate: existing.targetDate ? fromDbDate(existing.targetDate) : null,
    ...defined,
  });
  await assertHabitUsable(user, merged);

  const data: Prisma.GoalUncheckedUpdateInput = {
    habitId: merged.habitId,
    title: merged.title,
    description: merged.description,
    metric: merged.metric,
    targetValue: merged.targetValue,
    startDate: toDbDate(merged.startDate),
    targetDate: merged.targetDate ? toDbDate(merged.targetDate) : null,
  };
  if (status) {
    data.status = status;
    if (status === "ARCHIVED") data.completedAt = null;
  }
  const goal = await prisma.goal.update({ where: { id }, data });
  return (await evaluateAndSync(user, [goal]))[0];
}

export async function deleteGoal(user: SessionUser, id: string): Promise<void> {
  const { count } = await prisma.goal.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw Errors.notFound("Goal");
}
