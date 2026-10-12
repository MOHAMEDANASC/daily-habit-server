import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { historyQuerySchema } from "@/shared/validations/habit";
import { listCompletions } from "@/services/completions";

/** Paginated completion history across all of the caller's habits (filter by date range / habit). */
export const GET = apiRoute(async ({ request, user }) => {
  const query = parseQuery(request, historyQuerySchema);
  return ok(await listCompletions(user, query));
});
