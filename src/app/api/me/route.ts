import { apiRoute, ok, parseJson } from "@/lib/api/route";
import { destroyCurrentSession } from "@/lib/auth/session";
import { deleteAccountSchema, updateProfileSchema } from "@/shared/validations/auth";
import { deleteAccount, toUserDTO, updateProfile } from "@/services/accounts";

export const GET = apiRoute(async ({ user }) => ok({ user: toUserDTO(user) }));

export const PATCH = apiRoute(async ({ request, user }) => {
  const patch = await parseJson(request, updateProfileSchema);
  return ok({ user: await updateProfile(user, patch) });
});

export const DELETE = apiRoute(async ({ request, user }) => {
  const { password } = await parseJson(request, deleteAccountSchema);
  await deleteAccount(user, password);
  await destroyCurrentSession();
  return ok({ deleted: true });
});
