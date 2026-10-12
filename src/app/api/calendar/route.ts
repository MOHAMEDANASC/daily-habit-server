import { apiRoute, ok, parseQuery } from "@/lib/api/route";
import { calendarQuerySchema } from "@/lib/validations/misc";
import { getCalendar } from "@/services/dashboard";

export const GET = apiRoute(async ({ request, user }) => {
  const { month } = parseQuery(request, calendarQuerySchema);
  return ok(await getCalendar(user, month));
});
