import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import type { Prisma } from "@/generated/prisma/client";

export const SESSION_COOKIE = "habit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** The user fields that are safe to hand to application code and to the browser. */
export const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  timeZone: true,
  preferredTheme: true,
  weekStartsOn: true,
  remindersEnabled: true,
  milestoneAlerts: true,
  browserNotifications: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type SessionUser = Prisma.UserGetPayload<{ select: typeof sessionUserSelect }>;

/** Create a session row and set the HttpOnly cookie. Call only from route handlers / server actions. */
export async function createSession(userId: string, userAgent?: string | null): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the signed-in user from the session cookie (null when signed out or expired). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, lastUsedAt: true, user: { select: sessionUserSelect } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  return session.user;
});

/** For Server Components: redirect to the login page when nobody is signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Sign a user out everywhere (after a password change or reset). Optionally keep one session. */
export async function destroyUserSessions(userId: string, keepToken?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(keepToken ? { tokenHash: { not: hashToken(keepToken) } } : {}) },
  });
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
