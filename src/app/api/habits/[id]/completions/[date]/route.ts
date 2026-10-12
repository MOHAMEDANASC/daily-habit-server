import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { dateSchema } from "@/shared/validations/common";
import { completionBodySchema } from "@/shared/validations/habit";
import { setCompletion, undoCompletion } from "@/services/completions";

type Params = { id: string; date: string };

/** Mark done / record measurable progress / add notes for one habit on one day (idempotent upsert). */
export const PUT = apiRoute<Params>(async ({ request, params, user }) => {
  const date = dateSchema.parse(params.date);
  const body = await parseJson(request, completionBodySchema);
  return ok({ habit: await setCompletion(user, params.id, date, body) });
});

/** Undo: remove the day's entry. */
export const DELETE = apiRoute<Params>(async ({ params, user }) => {
  const date = dateSchema.parse(params.date);
  return ok({ habit: await undoCompletion(user, params.id, date) });
});
