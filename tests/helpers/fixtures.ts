import { expect } from "vitest";
import { ApiClient } from "./api-client";
import * as register from "@/app/api/auth/register/route";
import * as habits from "@/app/api/habits/route";
import * as completionByDate from "@/app/api/habits/[id]/completions/[date]/route";
import * as goals from "@/app/api/goals/route";

let counter = 0;

export interface TestUser {
  client: ApiClient;
  id: string;
  email: string;
  password: string;
}

/** Register a user and leave the client signed in. */
export async function signUp(overrides: { name?: string; email?: string; timeZone?: string; password?: string } = {}): Promise<TestUser> {
  counter += 1;
  const client = new ApiClient();
  const password = overrides.password ?? "Sup3rSecret!";
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`;
  const result = await client.call(register.POST, {
    method: "POST",
    path: "/api/auth/register",
    body: { name: overrides.name ?? `User ${counter}`, email, password, timeZone: overrides.timeZone ?? "UTC" },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { client, id: result.data.user.id, email, password };
}

export const dailyHabit = (overrides: Record<string, unknown> = {}) => ({
  name: "Read for 20 minutes",
  category: "LEARNING",
  icon: "book-open",
  color: "#6366f1",
  scheduleType: "DAILY",
  scheduledDays: [],
  startDate: "2024-01-01",
  ...overrides,
});

export async function createHabit(user: TestUser, overrides: Record<string, unknown> = {}) {
  const result = await user.client.call(habits.POST, { method: "POST", path: "/api/habits", body: dailyHabit(overrides) });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.data.habit as { id: string; name: string };
}

export async function complete(user: TestUser, habitId: string, date: string, body: Record<string, unknown> = {}) {
  return user.client.call(completionByDate.PUT, {
    method: "PUT",
    path: `/api/habits/${habitId}/completions/${date}`,
    params: { id: habitId, date },
    body,
  });
}

export async function createGoal(user: TestUser, body: Record<string, unknown>) {
  return user.client.call(goals.POST, { method: "POST", path: "/api/goals", body });
}
