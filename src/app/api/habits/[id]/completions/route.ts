import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { historyQuerySchema } from "@/shared/validations/habit";
import { listCompletions } from "@/services/completions";
import { getHabitOrThrow } from "@/services/habits";

/** Paginated completion history of one habit. */
export const GET = apiRoute<{ id: string }>(async ({ request, params, user }) => {
  await getHabitOrThrow(user, params.id); // 404 unless the habit belongs to the caller
  const query = parseQuery(request, historyQuerySchema);
  return ok(await listCompletions(user, { ...query, habitId: params.id }));
});
