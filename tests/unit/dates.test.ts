import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  diffDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  fromDbDate,
  isDateString,
  isMonthKey,
  isValidTimeZone,
  localTimeInTimeZone,
  startOfWeek,
  todayInTimeZone,
  toDbDate,
  weekdayOf,
} from "@/shared/dates";

describe("date string helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isDateString("2024-02-29")).toBe(true);
    expect(isDateString("2023-02-29")).toBe(false);
    expect(isDateString("2024-13-01")).toBe(false);
    expect(isDateString("2024-1-01")).toBe(false);
    expect(isDateString(20240101)).toBe(false);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2023-12-31", 1)).toBe("2024-01-01");
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
    expect(diffDays("2024-01-01", "2024-03-01")).toBe(60);
  });

  it("is not affected by daylight-saving transitions", () => {
    // US spring-forward (2024-03-10) and fall-back (2024-11-03) days still advance by exactly one.
    expect(addDays("2024-03-09", 1)).toBe("2024-03-10");
    expect(addDays("2024-03-10", 1)).toBe("2024-03-11");
    expect(diffDays("2024-11-02", "2024-11-04")).toBe(2);
  });

  it("computes weekdays (0 = Sunday)", () => {
    expect(weekdayOf("1970-01-01")).toBe(4);
    expect(weekdayOf("2024-01-01")).toBe(1);
    expect(weekdayOf("2024-02-29")).toBe(4);
    expect(weekdayOf("2024-03-03")).toBe(0);
  });

  it("finds the start and end of a week for either week-start preference", () => {
    // 2024-05-15 is a Wednesday.
    expect(startOfWeek("2024-05-15", 1)).toBe("2024-05-13");
    expect(endOfWeek("2024-05-15", 1)).toBe("2024-05-19");
    expect(startOfWeek("2024-05-15", 0)).toBe("2024-05-12");
    expect(startOfWeek("2024-05-12", 0)).toBe("2024-05-12");
    expect(startOfWeek("2024-05-12", 1)).toBe("2024-05-06");
  });

  it("handles months", () => {
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(endOfMonth("2023-02-10")).toBe("2023-02-28");
    expect(addMonths("2024-01", -1)).toBe("2023-12");
    expect(addMonths("2024-11", 3)).toBe("2025-02");
    expect(isMonthKey("2024-02")).toBe(true);
    expect(isMonthKey("2024-00")).toBe(false);
  });

  it("lists days inclusively", () => {
    expect(eachDay("2024-02-27", "2024-03-01")).toEqual(["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(eachDay("2024-03-02", "2024-03-01")).toEqual([]);
  });

  it("round-trips through database dates", () => {
    expect(fromDbDate(toDbDate("2024-07-04"))).toBe("2024-07-04");
    expect(toDbDate("2024-07-04").toISOString()).toBe("2024-07-04T00:00:00.000Z");
  });
});

describe("time zone boundaries", () => {
  // 2024-03-10T02:30:00Z
  const instant = new Date("2024-03-10T02:30:00Z");

  it("resolves a different local day per zone for the same instant", () => {
    expect(todayInTimeZone("UTC", instant)).toBe("2024-03-10");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2024-03-09");
    expect(todayInTimeZone("Asia/Kolkata", instant)).toBe("2024-03-10");
    expect(todayInTimeZone("Pacific/Auckland", instant)).toBe("2024-03-10");
  });

  it("rolls the day over exactly at local midnight", () => {
    // Asia/Kolkata is UTC+5:30: 18:29:59Z is 23:59:59 local, 18:30:00Z is the next day.
    expect(todayInTimeZone("Asia/Kolkata", new Date("2024-06-01T18:29:59Z"))).toBe("2024-06-01");
    expect(todayInTimeZone("Asia/Kolkata", new Date("2024-06-01T18:30:00Z"))).toBe("2024-06-02");
  });

  it("follows daylight-saving offsets", () => {
    // New York is UTC-5 before 2024-03-10 07:00Z and UTC-4 after it.
    expect(todayInTimeZone("America/New_York", new Date("2024-03-10T04:59:00Z"))).toBe("2024-03-09");
    expect(todayInTimeZone("America/New_York", new Date("2024-03-10T05:00:00Z"))).toBe("2024-03-10");
    expect(todayInTimeZone("America/New_York", new Date("2024-03-11T03:59:00Z"))).toBe("2024-03-10");
    expect(todayInTimeZone("America/New_York", new Date("2024-03-11T04:00:00Z"))).toBe("2024-03-11");
  });

  it("reports local wall-clock time", () => {
    expect(localTimeInTimeZone("Asia/Kolkata", new Date("2024-06-01T18:30:00Z"))).toBe("00:00");
    expect(localTimeInTimeZone("America/Los_Angeles", instant)).toBe("18:30");
  });

  it("validates time zone identifiers", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
