import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { notificationPreferencesSchema } from "@/lib/validations/misc";
import { updateProfile } from "@/services/accounts";

export const GET = apiRoute(async ({ user }) =>
  ok({
    preferences: {
      remindersEnabled: user.remindersEnabled,
      milestoneAlerts: user.milestoneAlerts,
      browserNotifications: user.browserNotifications,
    },
  }),
);

export const PATCH = apiRoute(async ({ request, user }) => {
  const patch = await parseJson(request, notificationPreferencesSchema);
  const updated = await updateProfile(user, patch);
  return ok({
    preferences: {
      remindersEnabled: updated.remindersEnabled,
      milestoneAlerts: updated.milestoneAlerts,
      browserNotifications: updated.browserNotifications,
    },
  });
});
