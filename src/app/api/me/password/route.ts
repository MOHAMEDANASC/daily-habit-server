import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { currentSessionToken } from "@/lib/auth/session";
import { changePasswordSchema } from "@/shared/validations/auth";
import { changePassword } from "@/services/accounts";

export const PATCH = apiRoute(async ({ request, user }) => {
  const { currentPassword, newPassword } = await parseJson(request, changePasswordSchema);
  await changePassword(user, currentPassword, newPassword, await currentSessionToken());
  return ok({ message: "Password updated. Other devices have been signed out." });
});
