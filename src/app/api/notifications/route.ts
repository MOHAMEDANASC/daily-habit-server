import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { notificationListQuerySchema } from "@/lib/validations/misc";
import { generateRemindersForUser, listNotifications } from "@/services/notifications";

/**
 * List notifications. Opening the app also evaluates today's due reminders for the caller, so
 * in-app reminders appear without any background worker (the cron route covers closed tabs).
 */
export const GET = apiRoute(async ({ request, user }) => {
  const query = parseQuery(request, notificationListQuerySchema);
  await generateRemindersForUser(user);
  return ok(await listNotifications(user, query));
});
