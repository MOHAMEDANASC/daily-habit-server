import { z } from "zod";
import { CATEGORY_VALUES, HABIT_ICON_KEYS, SCHEDULE_TYPE_VALUES } from "../habits";
import { dateSchema, optionalText, paginationSchema } from "./common";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Raw field definitions, shared by the create schema and the (partial) update schema. */
export const habitFields = z.object({
  name: z.string().trim().min(1, "Give your habit a name.").max(100, "Use at most 100 characters."),
  description: optionalText(500),
  category: z.enum(CATEGORY_VALUES),
  customCategory: optionalText(40),
  icon: z.enum(HABIT_ICON_KEYS),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour."),
  scheduleType: z.enum(SCHEDULE_TYPE_VALUES),
  scheduledDays: z.array(z.number().int().min(0).max(6)).max(7),
  weeklyTarget: z.number().int().min(1, "At least 1 per week.").max(7, "At most 7 per week.").nullish(),
  targetValue: z.number().positive("Must be greater than zero.").max(1_000_000).nullish(),
  targetUnit: optionalText(30),
  reminderTime: z.string().regex(TIME_RE, "Use a time like 07:30.").nullish(),
  startDate: dateSchema,
});

export type HabitFieldsInput = z.input<typeof habitFields>;

/** Cross-field rules + normalisation so the database only ever sees consistent schedules. */
export const habitInputSchema = habitFields
  .superRefine((habit, ctx) => {
    if (habit.scheduleType === "SELECTED_DAYS" && new Set(habit.scheduledDays).size === 0) {
      ctx.addIssue({ code: "custom", path: ["scheduledDays"], message: "Pick at least one weekday." });
    }
    if (habit.scheduleType === "WEEKLY" && !habit.weeklyTarget) {
      ctx.addIssue({ code: "custom", path: ["weeklyTarget"], message: "Choose how many times per week." });
    }
    if (habit.category === "CUSTOM" && !habit.customCategory) {
      ctx.addIssue({ code: "custom", path: ["customCategory"], message: "Name your custom category." });
    }
    if (habit.targetUnit && !habit.targetValue) {
      ctx.addIssue({ code: "custom", path: ["targetValue"], message: "Enter a target for this unit." });
    }
  })
  .transform((habit) => ({
    ...habit,
    scheduledDays: habit.scheduleType === "SELECTED_DAYS" ? [...new Set(habit.scheduledDays)].sort((a, b) => a - b) : [],
    weeklyTarget: habit.scheduleType === "WEEKLY" ? (habit.weeklyTarget ?? 1) : null,
    customCategory: habit.category === "CUSTOM" ? habit.customCategory : null,
    targetValue: habit.targetValue ?? null,
    targetUnit: habit.targetValue ? habit.targetUnit : null,
    reminderTime: habit.reminderTime ?? null,
  }));

export type HabitInput = z.output<typeof habitInputSchema>;

/** Updates are validated field-by-field, then re-validated as a whole after merging with the stored habit. */
export const habitUpdateSchema = habitFields
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export type HabitUpdateInput = z.infer<typeof habitUpdateSchema>;

export const habitListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  status: z.enum(["active", "archived", "all", "completed", "incomplete"]).default("active"),
  sort: z.enum(["name", "created", "status"]).default("created"),
  order: z.enum(["asc", "desc"]).default("desc"),
  /** Day used by the completed/incomplete filters and the returned completion state. */
  date: dateSchema.optional(),
});

export type HabitListQuery = z.infer<typeof habitListQuerySchema>;

export const completionBodySchema = z
  .object({
    completed: z.boolean().optional(),
    progressValue: z.number().min(0, "Cannot be negative.").max(1_000_000).nullish(),
    notes: optionalText(1000).optional(),
  })
  .default({});

export type CompletionBody = z.output<typeof completionBodySchema>;

export const historyQuerySchema = paginationSchema.extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  habitId: z.string().max(40).optional(),
});
