/**
 * Development seed: ONE clearly-labelled demo account with realistic history.
 *
 *   npm run db:seed
 *
 * Safety rules:
 *  - refuses to run when NODE_ENV=production (unless SEED_ALLOW_PRODUCTION=yes-i-am-sure),
 *  - only ever touches the demo account (demo@habit-tracker.local), never other users,
 *  - generates deterministic pseudo-random history, so every run produces the same data.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { addDays, toDbDate, todayInTimeZone, weekdayOf } from "../src/shared/dates";

const DEMO_EMAIL = "demo@habit-tracker.local";
const DEMO_PASSWORD = "Demo-pass123";
const TIME_ZONE = "UTC";
const HISTORY_DAYS = 75;

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "yes-i-am-sure") {
  console.error("Refusing to seed: NODE_ENV is production. Seed data is for local development only.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Small deterministic PRNG (mulberry32) so the demo data is reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedHabit {
  name: string;
  description: string;
  category: "HEALTH" | "FITNESS" | "LEARNING" | "PRODUCTIVITY" | "MINDFULNESS" | "PERSONAL_DEVELOPMENT" | "FINANCE" | "CUSTOM";
  icon: string;
  color: string;
  scheduleType: "DAILY" | "SELECTED_DAYS" | "WEEKLY";
  scheduledDays?: number[];
  weeklyTarget?: number;
  targetValue?: number;
  targetUnit?: string;
  reminderTime?: string;
  /** Probability of completing a scheduled day (gets better over time). */
  reliability: number;
}

const HABITS: SeedHabit[] = [
  { name: "Read for 20 minutes", description: "A chapter before bed.", category: "LEARNING", icon: "book-open", color: "#6366f1", scheduleType: "DAILY", targetValue: 20, targetUnit: "minutes", reminderTime: "21:00", reliability: 0.82 },
  { name: "Exercise", description: "Gym or a run.", category: "FITNESS", icon: "dumbbell", color: "#f97316", scheduleType: "SELECTED_DAYS", scheduledDays: [1, 3, 5], reliability: 0.8 },
  { name: "Drink water", description: "Eight glasses through the day.", category: "HEALTH", icon: "droplets", color: "#0ea5e9", scheduleType: "DAILY", targetValue: 8, targetUnit: "glasses", reliability: 0.7 },
  { name: "Meditate", description: "Ten quiet minutes.", category: "MINDFULNESS", icon: "brain", color: "#8b5cf6", scheduleType: "WEEKLY", weeklyTarget: 3, reliability: 0.55 },
  { name: "Learn programming", description: "One focused practice session.", category: "PRODUCTIVITY", icon: "code", color: "#10b981", scheduleType: "SELECTED_DAYS", scheduledDays: [1, 2, 3, 4, 5], targetValue: 45, targetUnit: "minutes", reliability: 0.75 },
  { name: "Sleep on time", description: "In bed by 23:00.", category: "HEALTH", icon: "moon", color: "#64748b", scheduleType: "DAILY", reminderTime: "22:30", reliability: 0.6 },
];

async function main() {
  const today = todayInTimeZone(TIME_ZONE);
  const start = addDays(today, -(HISTORY_DAYS - 1));

  // Only the demo account is ever deleted; everything else is left alone.
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  const user = await prisma.user.create({
    data: { name: "Demo User", email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD), timeZone: TIME_ZONE, weekStartsOn: 1 },
  });

  const habitIds = new Map<string, string>();
  let totalCompletions = 0;

  for (const [index, seed] of HABITS.entries()) {
    const random = rng(1000 + index);
    const habit = await prisma.habit.create({
      data: {
        userId: user.id,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        icon: seed.icon,
        color: seed.color,
        scheduleType: seed.scheduleType,
        scheduledDays: seed.scheduledDays ?? [],
        weeklyTarget: seed.weeklyTarget ?? null,
        targetValue: seed.targetValue ?? null,
        targetUnit: seed.targetUnit ?? null,
        reminderTime: seed.reminderTime ?? null,
        startDate: toDbDate(start),
      },
    });
    habitIds.set(seed.name, habit.id);

    const rows: Array<{ habitId: string; completionDate: Date; completedAt: Date | null; progressValue: number | null; notes: string | null }> = [];
    for (let offset = 0; offset < HISTORY_DAYS; offset++) {
      const date = addDays(start, offset);
      if (date > today) break;
      const progress = offset / HISTORY_DAYS; // reliability improves a little over time
      const chance = Math.min(0.97, seed.reliability + progress * 0.12);

      const scheduled =
        seed.scheduleType === "DAILY" ||
        (seed.scheduleType === "SELECTED_DAYS" && (seed.scheduledDays ?? []).includes(weekdayOf(date))) ||
        // Flexible weekly habit: tends to be done on 3 of 7 days.
        (seed.scheduleType === "WEEKLY" && random() < (seed.weeklyTarget ?? 3) / 7 + 0.05);
      if (!scheduled) continue;
      // Today stays open about half the time so the demo shows both states.
      const roll = date === today ? random() * 1.9 : random();
      if (roll > chance) {
        if (seed.targetValue && roll < chance + 0.1) {
          // A partly done day for measurable habits.
          rows.push({ habitId: habit.id, completionDate: toDbDate(date), completedAt: null, progressValue: Math.round(seed.targetValue * (0.3 + random() * 0.5)), notes: null });
        }
        continue;
      }
      const target = seed.targetValue;
      const noteChance = random();
      rows.push({
        habitId: habit.id,
        completionDate: toDbDate(date),
        completedAt: new Date(`${date}T${String(8 + Math.floor(random() * 13)).padStart(2, "0")}:${String(Math.floor(random() * 60)).padStart(2, "0")}:00.000Z`),
        progressValue: target ? Math.round(target * (1 + random() * 0.25)) : null,
        notes: noteChance < 0.06 ? "Felt easy today." : noteChance < 0.1 ? "Pushed through even though I was tired." : null,
      });
    }
    await prisma.habitCompletion.createMany({ data: rows });
    totalCompletions += rows.length;
  }

  await prisma.goal.createMany({
    data: [
      { userId: user.id, habitId: habitIds.get("Meditate")!, title: "30 days of meditation", metric: "COMPLETIONS", targetValue: 30, startDate: toDbDate(start), targetDate: toDbDate(addDays(today, 30)) },
      { userId: user.id, habitId: habitIds.get("Read for 20 minutes")!, title: "Read for 7 days in a row", metric: "STREAK", targetValue: 7, startDate: toDbDate(start) },
      { userId: user.id, habitId: habitIds.get("Drink water")!, title: "Drink 400 glasses of water", metric: "QUANTITY", targetValue: 400, startDate: toDbDate(start), targetDate: toDbDate(addDays(today, 60)) },
    ],
  });
  await prisma.notification.create({
    data: { userId: user.id, type: "SYSTEM", title: "Welcome to the demo account", message: "This account is filled with sample data for local development.", href: "/dashboard", dedupeKey: "welcome" },
  });

  console.log(`Seeded demo account with ${HABITS.length} habits and ${totalCompletions} completions.`);
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
