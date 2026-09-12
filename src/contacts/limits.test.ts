/**
 * covers: spec 0009 AC-4
 */
import { describe, expect, it } from "vitest";

import {
  COOLDOWN_MINUTES,
  DAILY_CAP,
  INVITE_TTL_DAYS,
  cooldownRefuses,
  dailyCapRefuses,
  inviteExpiry,
} from "./limits";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

describe("cooldownRefuses", () => {
  it("allows a contact never sent to", () => {
    expect(cooldownRefuses(null, NOW)).toBe(false);
  });

  it("refuses inside five minutes", () => {
    expect(cooldownRefuses(minutesAgo(0), NOW)).toBe(true);
    expect(cooldownRefuses(minutesAgo(4.99), NOW)).toBe(true);
  });

  it("allows exactly five minutes, and anything older", () => {
    expect(cooldownRefuses(minutesAgo(COOLDOWN_MINUTES), NOW)).toBe(false);
    expect(cooldownRefuses(minutesAgo(60), NOW)).toBe(false);
  });
});

describe("dailyCapRefuses", () => {
  it("allows forty nine sends in the last day", () => {
    const sends = Array.from({ length: DAILY_CAP - 1 }, (_, i) =>
      minutesAgo(i + 1),
    );

    expect(dailyCapRefuses(sends, NOW)).toBe(false);
  });

  it("refuses at the fiftieth", () => {
    const sends = Array.from({ length: DAILY_CAP }, (_, i) =>
      minutesAgo(i + 1),
    );

    expect(dailyCapRefuses(sends, NOW)).toBe(true);
  });

  it("counts only stamps strictly inside twenty four hours", () => {
    const boundary = new Date(NOW.getTime() - 24 * HOUR);
    const justInside = new Date(boundary.getTime() + 1);
    const atBoundary = Array.from({ length: DAILY_CAP }, () => boundary);
    const inside = Array.from({ length: DAILY_CAP }, () => justInside);

    expect(dailyCapRefuses(atBoundary, NOW)).toBe(false);
    expect(dailyCapRefuses(inside, NOW)).toBe(true);
  });

  it("ignores stamps older than a day even when there are many", () => {
    const old = Array.from({ length: 200 }, (_, i) => minutesAgo(25 * 60 + i));

    expect(dailyCapRefuses(old, NOW)).toBe(false);
  });
});

describe("inviteExpiry", () => {
  it("is seven days from now", () => {
    expect(inviteExpiry(NOW).toISOString()).toBe("2026-09-19T12:00:00.000Z");
    expect(INVITE_TTL_DAYS).toBe(7);
  });
});
