import { afterAll, beforeEach, vi } from "vitest";
import { resolveTestDatabaseUrl } from "./test-database";
import { cookieJar } from "./cookie-jar";

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.APP_URL = "http://localhost:3000";
process.env.RATE_LIMIT_DISABLED = "";
process.env.SMTP_HOST = "";
process.env.CRON_SECRET = "test-cron-secret-0123456789abcdef";

// Route handlers read cookies through next/headers, which only exists inside a Next.js request.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.active.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void cookieJar.active.set(name, value),
    delete: (name: string) => void cookieJar.active.delete(name),
  }),
}));

beforeEach(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "RateLimit" RESTART IDENTITY CASCADE`);
  cookieJar.active = new Map();
});

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
});
