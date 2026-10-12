import { config } from "dotenv";

/**
 * Resolve the database used by integration tests and refuse to touch anything that is not
 * clearly a test database: the suite truncates every table.
 */
export function resolveTestDatabaseUrl(): string {
  config({ path: ".env", quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Point it at a dedicated, disposable PostgreSQL database.");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to run integration tests against "${databaseName}": the database name must contain "test".`);
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");
  }
  return url;
}
