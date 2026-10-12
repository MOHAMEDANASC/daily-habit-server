import { clientIp, ok, parseJson, publicRoute } from "@/lib/api/route";
import { forgotPasswordSchema } from "@/shared/validations/auth";
import { requestPasswordReset } from "@/services/accounts";

export const POST = publicRoute(async ({ request }) => {
  const { email } = await parseJson(request, forgotPasswordSchema);
  await requestPasswordReset(email, clientIp(request));
  // Same response whether or not the account exists.
  return ok({ message: "If an account exists for that email, a reset link is on its way." });
});
