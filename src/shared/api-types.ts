import type { HabitCategoryValue, ScheduleTypeValue } from "./habits";

/** Shapes returned by the REST API. Dates are `YYYY-MM-DD` local days; instants are ISO strings. */

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: { code: string; message: string; details?: Record<string, string> };
}

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  preferredTheme: ThemePreference;
  weekStartsOn: number;
  remindersEnabled: boolean;
  milestoneAlerts: boolean;
  browserNotifications: boolean;
  createdAt: string;
}

export interface HabitDTO {
  id: string;
  name: string;
  description: string | null;
  category: HabitCategoryValue;
  customCategory: string | null;
  categoryLabel: string;
  icon: string;
  color: string;
  scheduleType: ScheduleTypeValue;
  scheduledDays: number[];
  weeklyTarget: number | null;
  scheduleLabel: string;
  targetValue: number | null;
  targetUnit: string | null;
  reminderTime: string | null;
  startDate: string;
  archivedAt: string | null;
  isArchived: boolean;
  createdAt: string;
}

export type HabitDayState = "done" | "partial" | "pending";

export interface StreakSummaryDTO {
  unit: "day" | "week";
  current: number;
  longest: number;
}

/** A habit together with its state on one particular day. */
export interface HabitStateDTO extends HabitDTO {
  date: string;
  /** The habit has a fixed occurrence on this day (DAILY / SELECTED_DAYS). */
  scheduledOnDate: boolean;
  /** The habit can be logged on this day (scheduled, or a flexible WEEKLY habit). */
  availableOnDate: boolean;
  state: HabitDayState;
  progressValue: number | null;
  notes: string | null;
  completedAt: string | null;
  /** Present for WEEKLY habits: completions so far in the week containing `date`. */
  weekly: { count: number; target: number } | null;
  streak: StreakSummaryDTO;
}

export type DayStatus = "none" | "missed" | "partial" | "complete";

export interface DaySummaryDTO {
  date: string;
  scheduled: number;
  completed: number;
  percentage: number;
  status: DayStatus;
}

export interface DailyDTO {
  date: string;
  today: string;
  isToday: boolean;
  isFuture: boolean;
  habits: HabitStateDTO[];
  summary: DaySummaryDTO;
}

export interface StreakRunDTO {
  start: string;
  end: string;
  length: number;
}

export interface StreakDetailDTO {
  unit: "day" | "week";
  current: number;
  longest: number;
  currentRun: StreakRunDTO | null;
  longestRun: StreakRunDTO | null;
  recentRuns: StreakRunDTO[];
  totalCompletions: number;
  lastCompletedOn: string | null;
}

export interface HabitDetailDTO {
  habit: HabitDTO;
  streak: StreakDetailDTO;
  consistency: { last7: number | null; last30: number | null; allTime: number | null };
  /** The last 30 days, oldest first. */
  recent: Array<{ date: string; scheduled: boolean; state: HabitDayState | "none"; progressValue: number | null }>;
  weekly: { count: number; target: number } | null;
}

export interface CompletionDTO {
  id: string;
  habitId: string;
  habitName: string;
  habitColor: string;
  habitIcon: string;
  date: string;
  completed: boolean;
  completedAt: string | null;
  progressValue: number | null;
  notes: string | null;
  targetUnit: string | null;
}

export interface PageDTO<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface DashboardDTO {
  date: string;
  user: { name: string };
  totals: { activeHabits: number; completedToday: number; remainingToday: number; percentage: number; scheduledToday: number };
  streaks: {
    perfectDay: { current: number; longest: number };
    topHabits: Array<{ habitId: string; name: string; color: string; icon: string; unit: "day" | "week"; current: number; longest: number }>;
  };
  totalCompletions: number;
  week: DaySummaryDTO[];
  weekProgress: { completed: number; scheduled: number; percentage: number };
  todayHabits: HabitStateDTO[];
  recentActivity: CompletionDTO[];
}

export interface CalendarDayDTO extends DaySummaryDTO {
  isToday: boolean;
  isFuture: boolean;
}

export interface CalendarDTO {
  month: string;
  today: string;
  weekStartsOn: number;
  days: CalendarDayDTO[];
}

export interface TrendPoint {
  /** Start day of the bucket. */
  date: string;
  label: string;
  completed: number;
  scheduled: number;
  /** 0–100 */
  percentage: number;
}

export interface HabitReportDTO {
  id: string;
  name: string;
  color: string;
  icon: string;
  category: HabitCategoryValue;
  categoryLabel: string;
  isArchived: boolean;
  rate: number | null;
  previousRate: number | null;
  expected: number;
  actual: number;
  streak: StreakSummaryDTO;
}

export interface CategoryReportDTO {
  category: HabitCategoryValue;
  label: string;
  habits: number;
  rate: number | null;
  actual: number;
  expected: number;
}

export interface AnalyticsDTO {
  range: { from: string; to: string; days: number };
  previous: { from: string; to: string };
  hasEnoughData: boolean;
  totals: {
    completions: number;
    previousCompletions: number;
    rate: number | null;
    previousRate: number | null;
    perfectDays: number;
    activeDays: number;
  };
  series: { day: TrendPoint[]; week: TrendPoint[]; month: TrendPoint[] };
  cumulative: Array<{ date: string; total: number }>;
  habits: HabitReportDTO[];
  categories: CategoryReportDTO[];
  best: HabitReportDTO[];
  needsImprovement: HabitReportDTO[];
}

export type GoalMetricValue = "COMPLETIONS" | "STREAK" | "QUANTITY";
export type GoalStatusValue = "ACTIVE" | "COMPLETED" | "ARCHIVED";

export interface GoalMilestoneDTO {
  percent: number;
  value: number;
  reached: boolean;
  reachedOn: string | null;
}

export interface GoalDTO {
  id: string;
  title: string;
  description: string | null;
  metric: GoalMetricValue;
  habit: { id: string; name: string; color: string; icon: string; targetUnit: string | null } | null;
  targetValue: number;
  currentValue: number;
  /** 0–1 */
  progress: number;
  unitLabel: string;
  startDate: string;
  targetDate: string | null;
  status: GoalStatusValue;
  completedAt: string | null;
  isOverdue: boolean;
  daysLeft: number | null;
  milestones: GoalMilestoneDTO[];
}

export type NotificationTypeValue = "REMINDER" | "MILESTONE" | "STREAK" | "SYSTEM";

export interface NotificationDTO {
  id: string;
  title: string;
  message: string;
  type: NotificationTypeValue;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPageDTO extends PageDTO<NotificationDTO> {
  unreadCount: number;
}
