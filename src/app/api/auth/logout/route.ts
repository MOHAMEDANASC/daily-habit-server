import { destroyCurrentSession } from "@/lib/auth/session";
import { ok, publicRoute } from "@/lib/api/route";

export const POST = publicRoute(async () => {
  await destroyCurrentSession();
  return ok({ loggedOut: true });
});
