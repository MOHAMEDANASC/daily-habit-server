import { apiRoute, ok } from "@/lib/api/route";
import { getDashboard } from "@/services/dashboard";

export const GET = apiRoute(async ({ user }) => ok(await getDashboard(user)));
