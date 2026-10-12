import { z } from "zod";
import { isDateString, isMonthKey, isValidTimeZone } from "../dates";

export const dateSchema = z.string().refine(isDateString, "Use a valid date (YYYY-MM-DD).");
export const monthSchema = z.string().refine(isMonthKey, "Use a valid month (YYYY-MM).");
export const idSchema = z.string().min(1).max(40);
export const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, "Unknown time zone.");

/** Optional free text: trims, and turns empty strings into null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254, "That email is too long."));

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "Include at least one letter and one number.");

/** Query-string booleans arrive as "true"/"false" strings. */
export const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const MAX_RANGE_DAYS = 400;
