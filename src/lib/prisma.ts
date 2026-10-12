import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  const { DATABASE_URL, NODE_ENV } = getEnv();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({ adapter, log: NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

function client(): PrismaClient {
  return (globalForPrisma.__prisma ??= createClient());
}

/**
 * Shared Prisma client. It is created on first use (so importing it never needs a database,
 * e.g. during `next build`) and cached on `globalThis` to survive dev hot reloads.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type { PrismaClient };
