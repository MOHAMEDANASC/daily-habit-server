import { clientIp, ok, parseJson, publicRoute } from "@/lib/api/route";
import { resetPasswordSchema } from "@/shared/validations/auth";
import { completePasswordReset } from "@/services/accounts";

export const POST = publicRoute(async ({ request }) => {
  const { token, password } = await parseJson(request, resetPasswordSchema);
  await completePasswordReset(token, password, clientIp(request));
  return ok({ message: "Your password has been updated. You can sign in now." });
});
