import "server-only";
import { Errors } from "@/lib/api/errors";
import { getEnv } from "@/lib/env";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { destroyUserSessions, sessionUserSelect, type SessionUser } from "@/lib/auth/session";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { passwordResetEmail, sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import type { RegisterInput, UpdateProfileInput } from "@/shared/validations/auth";
import { createNotification } from "@/services/notifications";
import type { UserDTO } from "@/shared/api-types";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function toUserDTO(user: SessionUser): UserDTO {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

async function enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await rateLimit(key, limit, windowSeconds);
  if (!result.allowed) throw Errors.tooManyRequests(result.retryAfterSeconds);
}

export async function registerUser(input: RegisterInput, ip: string): Promise<SessionUser> {
  await enforce(`register:ip:${ip}`, 10, 60 * 60);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw Errors.conflict("An account with this email already exists.", { email: "This email is already registered." });

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      timeZone: input.timeZone ?? "UTC",
    },
    select: sessionUserSelect,
  });

  await createNotification(user.id, {
    type: "SYSTEM",
    title: `Welcome, ${user.name.split(" ")[0]}!`,
    message: "Create your first habit and check it off each day to start a streak.",
    href: "/habits/new",
    dedupeKey: "welcome",
  });
  return user;
}

/** Verify credentials. Failures are indistinguishable (same message, same timing) for unknown emails. */
export async function authenticate(email: string, password: string, ip: string): Promise<SessionUser> {
  await enforce(`login:ip:${ip}`, 30, 15 * 60);
  await enforce(`login:email:${email}`, 10, 15 * 60);

  const record = await prisma.user.findUnique({ where: { email }, select: { ...sessionUserSelect, passwordHash: true } });
  if (!record) {
    await verifyAgainstDummy(password);
    throw Errors.unauthorized("Incorrect email or password.");
  }
  const { passwordHash, ...user } = record;
  if (!(await verifyPassword(password, passwordHash))) throw Errors.unauthorized("Incorrect email or password.");
  return user;
}

/**
 * Start a password reset. Always behaves the same from the caller's point of view, whether or not
 * the address belongs to an account, so it cannot be used to discover registered emails.
 */
export async function requestPasswordReset(email: string, ip: string): Promise<void> {
  await enforce(`reset-request:ip:${ip}`, 10, 60 * 60);
  const limited = !(await rateLimit(`reset-request:email:${email}`, 3, 60 * 60)).allowed;
  if (limited) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) return;

  const token = generateToken();
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    }),
  ]);

  const link = `${getEnv().APP_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...passwordResetEmail(user.name, link) });
}

export async function completePasswordReset(token: string, password: string, ip: string): Promise<void> {
  await enforce(`reset-complete:ip:${ip}`, 10, 60 * 60);

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw Errors.badRequest("This reset link is invalid or has expired. Request a new one.");
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // Claiming the token is atomic: a second concurrent use updates zero rows and aborts.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw Errors.badRequest("This reset link is invalid or has expired. Request a new one.");
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: record.userId } });
  });
}

export async function changePassword(
  user: SessionUser,
  currentPassword: string,
  newPassword: string,
  keepSessionToken?: string,
): Promise<void> {
  await enforce(`change-password:user:${user.id}`, 5, 15 * 60);
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(currentPassword, record.passwordHash))) {
    throw Errors.validation({ currentPassword: "That is not your current password." });
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  await destroyUserSessions(user.id, keepSessionToken);
}

export async function updateProfile(user: SessionUser, patch: UpdateProfileInput): Promise<UserDTO> {
  const updated = await prisma.user.update({ where: { id: user.id }, data: patch, select: sessionUserSelect });
  return toUserDTO(updated);
}

export async function deleteAccount(user: SessionUser, password: string): Promise<void> {
  await enforce(`delete-account:user:${user.id}`, 5, 15 * 60);
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(password, record.passwordHash))) {
    throw Errors.validation({ password: "That password is not correct." });
  }
  // Habits, completions, goals, notifications, sessions and tokens all cascade from the user row.
  await prisma.user.delete({ where: { id: user.id } });
}
