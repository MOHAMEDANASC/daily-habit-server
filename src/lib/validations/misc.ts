import { z } from "zod";
import { CATEGORY_VALUES } from "@/shared/habits";
import { MAX_RANGE_DAYS, dateSchema, monthSchema, paginationSchema } from "@/shared/validations/common";
import { diffDays } from "@/shared/dates";

export const notificationListQuerySchema = paginationSchema.extend({
  status: z.enum(["all", "unread"]).default("all"),
});

export const notificationUpdateSchema = z
  .object({ read: z.boolean(), dismissed: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const notificationPreferencesSchema = z
  .object({
    remindersEnabled: z.boolean(),
    milestoneAlerts: z.boolean(),
    browserNotifications: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const calendarQuerySchema = z.object({ month: monthSchema });

export const dailyQuerySchema = z.object({ date: dateSchema.optional() });

export const rangeQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    habitId: z.string().max(40).optional(),
    category: z.enum(CATEGORY_VALUES).optional(),
    groupBy: z.enum(["day", "week", "month"]).default("day"),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ["to"],
    message: "The end date must be on or after the start date.",
  })
  .refine((value) => !value.from || !value.to || diffDays(value.from, value.to) <= MAX_RANGE_DAYS, {
    path: ["to"],
    message: `Choose a range of at most ${MAX_RANGE_DAYS} days.`,
  });

export type RangeQuery = z.infer<typeof rangeQuerySchema>;
