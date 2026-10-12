import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { rangeQuerySchema } from "@/lib/validations/misc";
import { getAnalytics } from "@/services/analytics";

/** Trends, per-habit and per-category reports for a date range (default: last 30 days). */
export const GET = apiRoute(async ({ request, user }) => {
  const query = parseQuery(request, rangeQuerySchema);
  return ok(await getAnalytics(user, query));
});
