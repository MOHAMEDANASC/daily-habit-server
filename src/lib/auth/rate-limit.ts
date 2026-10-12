import "server-only";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter stored in PostgreSQL, so the limit is shared by every server instance
 * (an in-memory map would be per-process and useless on serverless platforms).
 * The upsert is a single atomic statement; concurrent requests cannot under-count.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  if (getEnv().RATE_LIMIT_DISABLED === "true") return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt}::timestamp)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= ${now}::timestamp THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now}::timestamp THEN ${resetAt}::timestamp ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  if (Math.random() < 0.01) {
    // Opportunistic cleanup keeps the table small without needing a scheduler.
    void prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => undefined);
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000));
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfterSeconds };
}
