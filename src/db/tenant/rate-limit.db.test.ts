/**
 * @vitest-environment node
 *
 * covers: spec 0018 AC-1, AC-2, AC-3, AC-4, AC-7, AC-8
 *
 * `consume` against real PostgreSQL. The upsert is the mechanism worth a
 * database rather than a mock: 60 attempts against a fresh window, arriving
 * from separate connections the way separate serverless invocations would,
 * all succeed and leave `count = 60`; the 61st, whichever lands last, is
 * refused. Rows are tracked by their primary key and deleted in `afterEach`,
 * the same pattern `retention-sweep.db.test.ts` uses, because the
 * concurrency case specifically needs real separate statements rather than
 * one rolled back transaction.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { rateLimitWindows } from "@/db/schema";
import { loadEnvFiles } from "@/lib/load-env-files";

import { UPLOAD } from "@/rate-limit/policies";

import { consume, type RateLimitSubject } from "./rate-limit";

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 5 });
const db = drizzle(sql, { schema });

function tag(): string {
  return Math.random().toString(36).slice(2, 12);
}

const createdSubjectKeys: string[] = [];

function trackedSubject(kind: RateLimitSubject["kind"]): RateLimitSubject {
  const subject: RateLimitSubject = { kind, id: `test_${tag()}` };
  createdSubjectKeys.push(`${kind}:${subject.id}`);
  return subject;
}

afterEach(async () => {
  for (const subjectKey of createdSubjectKeys.splice(0)) {
    await db
      .delete(rateLimitWindows)
      .where(eq(rateLimitWindows.subject, subjectKey));
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("consume against real PostgreSQL", () => {
  it("allows every attempt at or under the limit and refuses past it (AC-1, AC-3)", async () => {
    const subject = trackedSubject("org");
    const now = new Date("2026-06-15T14:05:00.000Z");

    for (let i = 0; i < UPLOAD.limit; i++) {
      const verdict = await consume(subject, UPLOAD, now);
      expect(verdict.allowed).toBe(true);
    }

    const [row] = await db
      .select()
      .from(rateLimitWindows)
      .where(
        and(
          eq(rateLimitWindows.subject, `org:${subject.id}`),
          eq(rateLimitWindows.action, "upload"),
        ),
      );

    expect(row?.count).toBe(UPLOAD.limit);

    const refused = await consume(subject, UPLOAD, now);

    expect(refused).toMatchObject({
      allowed: false,
      count: UPLOAD.limit + 1,
      limit: UPLOAD.limit,
      message:
        "Your agency has reached its upload allowance of 60 an hour. Try again in about 55 minutes.",
    });

    const [rowAfterRefusal] = await db
      .select()
      .from(rateLimitWindows)
      .where(
        and(
          eq(rateLimitWindows.subject, `org:${subject.id}`),
          eq(rateLimitWindows.action, "upload"),
        ),
      );

    expect(rowAfterRefusal?.count).toBe(UPLOAD.limit + 1);
  });

  it("60 parallel calls against a fresh window all succeed and leave count = 60, the 61st refused (AC-3)", async () => {
    const subject = trackedSubject("org");
    const now = new Date("2026-06-15T14:05:00.000Z");

    const verdicts = await Promise.all(
      Array.from({ length: UPLOAD.limit }, () => consume(subject, UPLOAD, now)),
    );

    expect(verdicts.every((verdict) => verdict.allowed)).toBe(true);

    const [row] = await db
      .select()
      .from(rateLimitWindows)
      .where(
        and(
          eq(rateLimitWindows.subject, `org:${subject.id}`),
          eq(rateLimitWindows.action, "upload"),
        ),
      );

    expect(row?.count).toBe(UPLOAD.limit);

    const refused = await consume(subject, UPLOAD, now);
    expect(refused.allowed).toBe(false);
  });

  it("starts a fresh row at count = 1 on the other side of a window boundary (AC-4)", async () => {
    const subject = trackedSubject("org");

    for (let i = 0; i < UPLOAD.limit; i++) {
      await consume(subject, UPLOAD, new Date("2026-06-15T13:59:59.000Z"));
    }

    const nextHour = await consume(
      subject,
      UPLOAD,
      new Date("2026-06-15T14:00:00.000Z"),
    );

    expect(nextHour.allowed).toBe(true);

    const rows = await db
      .select()
      .from(rateLimitWindows)
      .where(eq(rateLimitWindows.subject, `org:${subject.id}`));

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.count === 1)).toBeDefined();
    expect(rows.find((r) => r.count === UPLOAD.limit)).toBeDefined();
  });

  it("logs rate_limit.refused with no email or name, and the exact identifiers (AC-8)", async () => {
    const subject = trackedSubject("org");
    const now = new Date("2026-06-15T14:05:00.000Z");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (let i = 0; i < UPLOAD.limit; i++) {
      await consume(subject, UPLOAD, now);
    }

    warn.mockClear();
    const refused = await consume(subject, UPLOAD, now);
    expect(refused.allowed).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;

    expect(line).toMatchObject({
      event: "rate_limit.refused",
      subject: `org:${subject.id}`,
      action: "upload",
      count: UPLOAD.limit + 1,
      limit: UPLOAD.limit,
    });
    expect(JSON.stringify(line)).not.toMatch(/@/);

    warn.mockRestore();
  });
});
