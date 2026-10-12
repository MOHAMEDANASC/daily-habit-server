import { apiRoute, created, ok, parseJson, parseQuery } from "@/lib/api/route";
import { goalInputSchema, goalListQuerySchema } from "@/shared/validations/goal";
import { createGoal, listGoals } from "@/services/goals";

export const GET = apiRoute(async ({ request, user }) => {
  const { status } = parseQuery(request, goalListQuerySchema);
  return ok({ goals: await listGoals(user, status) });
});

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseJson(request, goalInputSchema);
  return created({ goal: await createGoal(user, input) });
});
