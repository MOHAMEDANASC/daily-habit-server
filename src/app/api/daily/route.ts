import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { dailyQuerySchema } from "@/lib/validations/misc";
import { getDaily } from "@/services/habits";

/** Habits scheduled for a date (default: today in the user's time zone) with their completion state. */
export const GET = apiRoute(async ({ request, user }) => {
  const { date } = parseQuery(request, dailyQuerySchema);
  return ok(await getDaily(user, date));
});
