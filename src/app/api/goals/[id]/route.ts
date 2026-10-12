import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { goalUpdateSchema } from "@/shared/validations/goal";
import { deleteGoal, getGoal, updateGoal } from "@/services/goals";

/** A goal with its live progress and milestones. */
export const GET = apiRoute<{ id: string }>(async ({ params, user }) => ok({ goal: await getGoal(user, params.id) }));

export const PATCH = apiRoute<{ id: string }>(async ({ request, params, user }) => {
  const patch = await parseJson(request, goalUpdateSchema);
  return ok({ goal: await updateGoal(user, params.id, patch) });
});

export const DELETE = apiRoute<{ id: string }>(async ({ params, user }) => {
  await deleteGoal(user, params.id);
  return ok({ deleted: true });
});
