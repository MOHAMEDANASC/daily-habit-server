import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `react-server` lets the shared `server-only` modules load outside Next.js.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
