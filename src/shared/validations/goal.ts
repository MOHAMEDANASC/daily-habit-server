import { z } from "zod";
import { dateSchema, optionalText } from "./common";

export const GOAL_METRICS = [
  { value: "COMPLETIONS", label: "Completed days", description: "Total days the habit was completed", unit: "days" },
  { value: "STREAK", label: "Streak", description: "Reach a streak of consecutive scheduled completions", unit: "streak" },
  { value: "QUANTITY", label: "Total quantity", description: "Add up the measurable progress you log", unit: "total" },
] as const;

export const goalFields = z.object({
  title: z.string().trim().min(1, "Give your goal a title.").max(120, "Use at most 120 characters."),
  description: optionalText(500),
  metric: z.enum(["COMPLETIONS", "STREAK", "QUANTITY"]),
  habitId: z.string().min(1).max(40).nullish(),
  targetValue: z.number().positive("Must be greater than zero.").max(1_000_000),
  startDate: dateSchema,
  targetDate: dateSchema.nullish(),
});

export const goalInputSchema = goalFields
  .superRefine((goal, ctx) => {
    if (goal.metric !== "COMPLETIONS" && !goal.habitId) {
      ctx.addIssue({ code: "custom", path: ["habitId"], message: "Choose the habit this goal tracks." });
    }
    if (goal.metric !== "QUANTITY" && !Number.isInteger(goal.targetValue)) {
      ctx.addIssue({ code: "custom", path: ["targetValue"], message: "Use a whole number." });
    }
    if (goal.targetDate && goal.targetDate < goal.startDate) {
      ctx.addIssue({ code: "custom", path: ["targetDate"], message: "The deadline must be after the start date." });
    }
  })
  .transform((goal) => ({ ...goal, habitId: goal.habitId ?? null, targetDate: goal.targetDate ?? null }));

export type GoalInput = z.output<typeof goalInputSchema>;

export const goalUpdateSchema = goalFields
  .partial()
  .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

export const goalListQuerySchema = z.object({
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED", "all"]).default("all"),
});
