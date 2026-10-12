import { z } from "zod";
import { addDays } from "@/shared/dates";
import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { dateSchema } from "@/shared/validations/common";
import { getCompletionSummaries } from "@/services/completions";
import { userToday } from "@/services/habits";

const querySchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });

/** Per-day totals (scheduled / completed / percentage); defaults to the last 7 days. */
export const GET = apiRoute(async ({ request, user }) => {
  const query = parseQuery(request, querySchema);
  const to = query.to ?? userToday(user);
  const from = query.from ?? addDays(to, -6);
  return ok({ days: await getCompletionSummaries(user, from, to) });
});
