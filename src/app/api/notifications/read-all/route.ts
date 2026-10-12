import { apiRoute, ok } from "@/lib/api/route";
import { markAllRead } from "@/services/notifications";

export const POST = apiRoute(async ({ user }) => ok({ updated: await markAllRead(user) }));
