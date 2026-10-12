import { createSession } from "@/lib/auth/session";
import { clientIp, created, parseJson, publicRoute } from "@/lib/api/route";
import { registerSchema } from "@/shared/validations/auth";
import { registerUser, toUserDTO } from "@/services/accounts";

export const POST = publicRoute(async ({ request }) => {
  const input = await parseJson(request, registerSchema);
  const user = await registerUser(input, clientIp(request));
  await createSession(user.id, request.headers.get("user-agent"));
  return created({ user: toUserDTO(user) });
});
