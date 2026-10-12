import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { notificationUpdateSchema } from "@/lib/validations/misc";
import { updateNotification } from "@/services/notifications";

/** Mark a notification read/unread or dismiss it. */
export const PATCH = apiRoute<{ id: string }>(async ({ request, params, user }) => {
  const patch = await parseJson(request, notificationUpdateSchema);
  return ok({ notification: await updateNotification(user, params.id, patch) });
});
