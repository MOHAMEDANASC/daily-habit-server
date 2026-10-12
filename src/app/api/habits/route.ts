import { apiRoute, created, ok, parseJson, parseQuery } from "@/lib/api/route";
import { habitInputSchema, habitListQuerySchema } from "@/shared/validations/habit";
import { createHabit, listHabits } from "@/services/habits";

export const GET = apiRoute(async ({ request, user }) => {
  const query = parseQuery(request, habitListQuerySchema);
  return ok({ habits: await listHabits(user, query) });
});

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseJson(request, habitInputSchema);
  return created({ habit: await createHabit(user, input) });
});
