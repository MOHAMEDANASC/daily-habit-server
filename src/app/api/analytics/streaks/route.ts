import { apiRoute, ok } from "@/lib/api/route";
import { getStreakOverview } from "@/services/dashboard";

/** Current / longest streak for every habit plus the overall perfect-day streak. */
export const GET = apiRoute(async ({ user }) => ok(await getStreakOverview(user)));
