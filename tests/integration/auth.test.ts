import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../helpers/api-client";
import { signUp } from "../helpers/fixtures";
import * as forgot from "@/app/api/auth/forgot-password/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as register from "@/app/api/auth/register/route";
import * as reset from "@/app/api/auth/reset-password/route";
import * as habitsRoute from "@/app/api/habits/route";
import * as me from "@/app/api/me/route";
import * as password from "@/app/api/me/password/route";
import { prisma } from "@/lib/prisma";

const sent = vi.hoisted(() => ({ messages: [] as Array<{ to: string; text: string }> }));
vi.mock("@/lib/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mailer")>()),
  sendMail: async (message: { to: string; text: string }) => {
    sent.messages.push(message);
    return true;
  },
}));

beforeEach(() => {
  sent.messages.length = 0;
});

const post = (client: ApiClient, handler: unknown, path: string, body: unknown, headers?: Record<string, string>) =>
  client.call(handler, { method: "POST", path, body, headers });

describe("registration", () => {
  it("creates an account, stores only a password hash and signs the user in", async () => {
    const user = await signUp({ email: "Ada@Example.com", password: "Passw0rd!x" });
    expect(user.client.signedIn).toBe(true);

    const record = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(record.passwordHash).toMatch(/^scrypt\$/);
    expect(record.passwordHash).not.toContain("Passw0rd");

    const current = await user.client.call(me.GET, { path: "/api/me" });
    expect(current.status).toBe(200);
    expect(current.data.user.email).toBe("ada@example.com");
    expect(current.data.user).not.toHaveProperty("passwordHash");
  });

  it("stores only a hash of the session token", async () => {
    await signUp();
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid input with field errors", async () => {
    const client = new ApiClient();
    const result = await post(client, register.POST, "/api/auth/register", { name: "", email: "nope", password: "short" });
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(result.body.error?.details ?? {})).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });

  it("rejects a duplicate email", async () => {
    await signUp({ email: "dup@example.com" });
    const result = await post(new ApiClient(), register.POST, "/api/auth/register", {
      name: "Again",
      email: "DUP@example.com",
      password: "Passw0rd!x",
    });
    expect(result.status).toBe(409);
  });
});

describe("login and logout", () => {
  it("signs in with the right password only", async () => {
    const user = await signUp({ email: "login@example.com", password: "Passw0rd!x" });
    const client = new ApiClient();

    const wrong = await post(client, login.POST, "/api/auth/login", { email: user.email, password: "Wrong-pass1" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error?.message).toBe("Incorrect email or password.");
    expect(client.signedIn).toBe(false);

    const unknown = await post(client, login.POST, "/api/auth/login", { email: "ghost@example.com", password: "Wrong-pass1" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error?.message).toBe(wrong.body.error?.message);

    const right = await post(client, login.POST, "/api/auth/login", { email: user.email, password: "Passw0rd!x" });
    expect(right.status).toBe(200);
    expect(client.signedIn).toBe(true);
  });

  it("protects private endpoints and ends the session on logout", async () => {
    const anonymous = await new ApiClient().call(habitsRoute.GET, { path: "/api/habits" });
    expect(anonymous.status).toBe(401);

    const user = await signUp();
    expect((await user.client.call(habitsRoute.GET, { path: "/api/habits" })).status).toBe(200);

    expect((await post(user.client, logout.POST, "/api/auth/logout", {})).status).toBe(200);
    expect(user.client.signedIn).toBe(false);
    expect(await prisma.session.count()).toBe(0);
    expect((await user.client.call(habitsRoute.GET, { path: "/api/habits" })).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const user = await signUp();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await user.client.call(me.GET, { path: "/api/me" })).status).toBe(401);
  });

  it("rate-limits repeated failed logins", async () => {
    const user = await signUp({ email: "brute@example.com" });
    const client = new ApiClient();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await post(client, login.POST, "/api/auth/login", { email: user.email, password: "Nope-nope1" });
      statuses.push(result.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const blocked = await post(client, login.POST, "/api/auth/login", { email: user.email, password: user.password });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("cross-site request protection", () => {
  it("rejects state-changing requests from another origin", async () => {
    const user = await signUp();
    const result = await post(user.client, habitsRoute.POST, "/api/habits", {}, { origin: "https://evil.example" });
    expect(result.status).toBe(403);
  });
});

describe("password reset", () => {
  const tokenFromEmail = () => {
    const link = sent.messages.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
    return new URL(link).searchParams.get("token") ?? "";
  };

  it("does not reveal whether an email is registered", async () => {
    const real = await signUp({ email: "real@example.com" });
    const a = await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: real.email });
    const b = await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: "nobody@example.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(sent.messages).toHaveLength(1);
  });

  it("resets the password once, stores only a token hash and signs out other sessions", async () => {
    const user = await signUp({ email: "reset@example.com", password: "Old-passw0rd" });
    await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: user.email });
    const token = tokenFromEmail();
    expect(token.length).toBeGreaterThan(20);

    const stored = await prisma.passwordResetToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const weak = await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token, password: "short" });
    expect(weak.status).toBe(400);

    const done = await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token, password: "Brand-new-1" });
    expect(done.status).toBe(200);

    const again = await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token, password: "Another-one-2" });
    expect(again.status).toBe(400);

    expect((await user.client.call(me.GET, { path: "/api/me" })).status).toBe(401);
    const fresh = new ApiClient();
    expect((await post(fresh, login.POST, "/api/auth/login", { email: user.email, password: "Old-passw0rd" })).status).toBe(401);
    expect((await post(fresh, login.POST, "/api/auth/login", { email: user.email, password: "Brand-new-1" })).status).toBe(200);
  });

  it("rejects unknown and expired tokens", async () => {
    const user = await signUp({ email: "expired@example.com" });
    await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: user.email });
    const token = tokenFromEmail();

    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token, password: "Brand-new-1" })).status).toBe(400);
    expect(
      (await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token: "x".repeat(43), password: "Brand-new-1" })).status,
    ).toBe(400);
  });

  it("invalidates earlier links when a new one is requested", async () => {
    const user = await signUp({ email: "twice@example.com" });
    await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: user.email });
    const first = tokenFromEmail();
    await post(new ApiClient(), forgot.POST, "/api/auth/forgot-password", { email: user.email });
    const second = tokenFromEmail();

    expect((await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token: first, password: "Brand-new-1" })).status).toBe(400);
    expect((await post(new ApiClient(), reset.POST, "/api/auth/reset-password", { token: second, password: "Brand-new-1" })).status).toBe(200);
  });
});

describe("account management", () => {
  it("updates the profile and validates the time zone", async () => {
    const user = await signUp();
    const ok = await user.client.call(me.PATCH, {
      method: "PATCH",
      path: "/api/me",
      body: { name: "New Name", timeZone: "Asia/Kolkata", preferredTheme: "DARK", weekStartsOn: 0 },
    });
    expect(ok.status).toBe(200);
    expect(ok.data.user).toMatchObject({ name: "New Name", timeZone: "Asia/Kolkata", preferredTheme: "DARK", weekStartsOn: 0 });

    const bad = await user.client.call(me.PATCH, { method: "PATCH", path: "/api/me", body: { timeZone: "Mars/Base" } });
    expect(bad.status).toBe(400);
  });

  it("changes the password only with the current password and keeps this session", async () => {
    const user = await signUp({ password: "Old-passw0rd" });
    const other = new ApiClient();
    await post(other, login.POST, "/api/auth/login", { email: user.email, password: "Old-passw0rd" });

    const wrong = await user.client.call(password.PATCH, {
      method: "PATCH",
      path: "/api/me/password",
      body: { currentPassword: "nope-nope-1", newPassword: "Brand-new-1" },
    });
    expect(wrong.status).toBe(400);

    const ok = await user.client.call(password.PATCH, {
      method: "PATCH",
      path: "/api/me/password",
      body: { currentPassword: "Old-passw0rd", newPassword: "Brand-new-1" },
    });
    expect(ok.status).toBe(200);
    expect((await user.client.call(me.GET, { path: "/api/me" })).status).toBe(200);
    expect((await other.call(me.GET, { path: "/api/me" })).status).toBe(401);
  });

  it("deletes the account and all of its data after password confirmation", async () => {
    const user = await signUp({ password: "Old-passw0rd" });
    const wrong = await user.client.call(me.DELETE, { method: "DELETE", path: "/api/me", body: { password: "nope-nope-1" } });
    expect(wrong.status).toBe(400);

    const ok = await user.client.call(me.DELETE, { method: "DELETE", path: "/api/me", body: { password: "Old-passw0rd" } });
    expect(ok.status).toBe(200);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });
});
