export const CATEGORIES = [
  { value: "HEALTH", label: "Health" },
  { value: "FITNESS", label: "Fitness" },
  { value: "LEARNING", label: "Learning" },
  { value: "PRODUCTIVITY", label: "Productivity" },
  { value: "MINDFULNESS", label: "Mindfulness" },
  { value: "PERSONAL_DEVELOPMENT", label: "Personal Development" },
  { value: "FINANCE", label: "Finance" },
  { value: "CUSTOM", label: "Custom" },
] as const;

export type HabitCategoryValue = (typeof CATEGORIES)[number]["value"];
export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as [HabitCategoryValue, ...HabitCategoryValue[]];

export function categoryLabel(category: HabitCategoryValue, custom?: string | null): string {
  if (category === "CUSTOM" && custom) return custom;
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

export const SCHEDULE_TYPES = [
  { value: "DAILY", label: "Every day" },
  { value: "SELECTED_DAYS", label: "Selected weekdays" },
  { value: "WEEKLY", label: "Times per week" },
] as const;

export type ScheduleTypeValue = (typeof SCHEDULE_TYPES)[number]["value"];
export const SCHEDULE_TYPE_VALUES = SCHEDULE_TYPES.map((s) => s.value) as [ScheduleTypeValue, ...ScheduleTypeValue[]];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const HABIT_ICON_KEYS = [
  "target",
  "book-open",
  "dumbbell",
  "droplets",
  "brain",
  "code",
  "moon",
  "heart",
  "apple",
  "coffee",
  "wallet",
  "pencil",
  "music",
  "sun",
  "footprints",
  "bike",
  "leaf",
  "smile",
  "sparkles",
  "clock",
  "languages",
  "piggy-bank",
  "bed",
  "salad",
] as const;

export type HabitIconKey = (typeof HABIT_ICON_KEYS)[number];

export const HABIT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#64748b",
] as const;

export const TIMEZONE_FALLBACKS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;
