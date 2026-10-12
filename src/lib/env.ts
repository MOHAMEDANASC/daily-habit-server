import "server-only";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((url) => /^postgres(ql)?:\/\//.test(url), "DATABASE_URL must be a PostgreSQL connection string"),
  APP_URL: z.url().default("http://localhost:3000"),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(587)),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().default("Habit Tracker <no-reply@localhost>")),
  CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16, "CRON_SECRET must be at least 16 characters").optional()),
  RATE_LIMIT_DISABLED: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment variables. Parsed lazily so `next build` works without runtime secrets. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
