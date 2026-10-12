import { createSession } from "@/lib/auth/session";
import { clientIp, ok, parseJson, publicRoute } from "@/lib/api/route";
import { loginSchema } from "@/shared/validations/auth";
import { authenticate, toUserDTO } from "@/services/accounts";

export const POST = publicRoute(async ({ request }) => {
  const { email, password } = await parseJson(request, loginSchema);
  const user = await authenticate(email, password, clientIp(request));
  await createSession(user.id, request.headers.get("user-agent"));
  return ok({ user: toUserDTO(user) });
});
