import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { habitUpdateSchema } from "@/shared/validations/habit";
import { getHabitDetail } from "@/services/dashboard";
import { deleteHabit, updateHabit } from "@/services/habits";

export const GET = apiRoute<{ id: string }>(async ({ params, user }) => ok(await getHabitDetail(user, params.id)));

/** Edit fields, and archive/reactivate with `{ "archived": true | false }`. */
export const PATCH = apiRoute<{ id: string }>(async ({ request, params, user }) => {
  const patch = await parseJson(request, habitUpdateSchema);
  return ok({ habit: await updateHabit(user, params.id, patch) });
});

export const DELETE = apiRoute<{ id: string }>(async ({ params, user }) => {
  await deleteHabit(user, params.id);
  return ok({ deleted: true });
});
