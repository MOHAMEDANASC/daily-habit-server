/**
 * Calendar-date helpers.
 *
 * Every "day" in the app is a plain `YYYY-MM-DD` string that describes the user's *local*
 * calendar day. Doing arithmetic on strings (via UTC epoch days) keeps results independent of
 * the server's time zone and of daylight-saving transitions. Only `todayInTimeZone` and
 * `localTimeInTimeZone` ever look at a real instant.
 */

export type DateString = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isDateString(value: unknown): value is DateString {
  if (typeof value !== "string") return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function assertDate(value: DateString): void {
  if (!isDateString(value)) throw new RangeError(`Invalid date string: ${String(value)}`);
}

export function toEpochDay(value: DateString): number {
  assertDate(value);
  const [y, m, d] = value.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromEpochDay(epochDay: number): DateString {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(value: DateString, days: number): DateString {
  return fromEpochDay(toEpochDay(value) + days);
}

/** Whole days from `a` to `b` (`b - a`). */
export function diffDays(a: DateString, b: DateString): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(value: DateString): number {
  // 1970-01-01 was a Thursday (4).
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

export function startOfWeek(value: DateString, weekStartsOn: number): DateString {
  const offset = (weekdayOf(value) - weekStartsOn + 7) % 7;
  return addDays(value, -offset);
}

export function endOfWeek(value: DateString, weekStartsOn: number): DateString {
  return addDays(startOfWeek(value, weekStartsOn), 6);
}

export function startOfMonth(value: DateString): DateString {
  assertDate(value);
  return `${value.slice(0, 7)}-01`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function endOfMonth(value: DateString): DateString {
  assertDate(value);
  const [y, m] = value.split("-").map(Number);
  return `${value.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** `YYYY-MM` → first day of that month. */
export function monthStart(monthKey: string): DateString {
  const date = `${monthKey}-01`;
  assertDate(date);
  return date;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && isDateString(`${value}-01`);
}

export function addMonths(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** All dates from `from` to `to`, inclusive. Empty when `from > to`. */
export function eachDay(from: DateString, to: DateString): DateString[] {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  const days: DateString[] = [];
  for (let day = start; day <= end; day++) days.push(fromEpochDay(day));
  return days;
}

export function minDate(a: DateString, b: DateString): DateString {
  return a <= b ? a : b;
}

export function maxDate(a: DateString, b: DateString): DateString {
  return a >= b ? a : b;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The calendar day it currently is in `timeZone`. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): DateString {
  const { year, month, day } = partsIn(timeZone, now);
  return `${year}-${month}-${day}`;
}

/** Wall-clock time (`HH:mm`) it currently is in `timeZone`. */
export function localTimeInTimeZone(timeZone: string, now: Date = new Date()): string {
  const { hour, minute } = partsIn(timeZone, now);
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/** The local calendar day an instant falls on in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): DateString {
  return todayInTimeZone(timeZone, instant);
}

/** Store a calendar day in a Postgres `date` column (UTC midnight avoids any shifting). */
export function toDbDate(value: DateString): Date {
  assertDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): DateString {
  return value.toISOString().slice(0, 10);
}

/** Human-readable formatting of a calendar day, independent of the viewer's zone. */
export function formatDate(
  value: DateString,
  options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  locale?: string,
): string {
  assertDate(value);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(toDbDate(value));
}
