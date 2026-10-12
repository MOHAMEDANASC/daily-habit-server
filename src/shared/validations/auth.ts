import { z } from "zod";
import { emailSchema, passwordSchema, timeZoneSchema } from "./common";

const nameSchema = z.string().trim().min(1, "Enter your name.").max(80, "Use at most 80 characters.");

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  timeZone: timeZoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20, "This reset link is invalid.").max(200, "This reset link is invalid."),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(128),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm.").max(128),
});

export const updateProfileSchema = z
  .object({
    name: nameSchema,
    timeZone: timeZoneSchema,
    preferredTheme: z.enum(["SYSTEM", "LIGHT", "DARK"]),
    weekStartsOn: z.number().int().min(0).max(6),
    remindersEnabled: z.boolean(),
    milestoneAlerts: z.boolean(),
    browserNotifications: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
