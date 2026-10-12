import { timingSafeEqual } from "node:crypto";
import { ApiError, Errors } from "@/lib/api/errors";
import { ok, publicRoute } from "@/lib/api/route";
import { getEnv } from "@/lib/env";
import { runReminderJob } from "@/services/notifications";

function authorised(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Scheduled reminder delivery. Call it every few minutes from a scheduler (Vercel Cron, GitHub
 * Actions, cron + curl, ...) with `Authorization: Bearer <CRON_SECRET>`. It creates the in-app
 * notifications for every user whose reminder time has passed; it is idempotent.
 */
async function handle(request: Request) {
  const { CRON_SECRET } = getEnv();
  if (!CRON_SECRET) throw new ApiError(503, "CRON_DISABLED", "Scheduled reminders are not configured.");
  if (!authorised(request.headers.get("authorization"), CRON_SECRET)) throw Errors.unauthorized("Invalid cron credentials.");
  return ok(await runReminderJob());
}

export const GET = publicRoute(({ request }) => handle(request));
export const POST = publicRoute(({ request }) => handle(request));
