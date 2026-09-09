/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-15 (exactly one structured line per refusal and per
 * grant, carrying operation and reason always, the identifiers when known, and
 * never any row contents)
 *
 * "Never any row contents" is not something an assertion can prove about every
 * future call site, so it is proved structurally instead: the emitted object
 * has a fixed key set, and anything a caller passes beyond those keys has
 * nowhere to land. The call sites that use this are checked in
 * `guards.test.ts`, `accessor.test.ts`, `unsafe.test.ts` and `system.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logEscapeHatch, logRefusal, logSystemAccess } from "./log";

const AT = "2026-09-08T10:30:00.000Z";

function lines(): Record<string, unknown>[] {
  return warned.map((raw) => {
    const parsed: unknown = JSON.parse(raw);

    return parsed as Record<string, unknown>;
  });
}

/** Every line console.warn received, captured as text. */
const warned: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AT));
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("logRefusal", () => {
  it("emits exactly one line, whatever else is happening", () => {
    logRefusal({ operation: "requireAdmin", reason: "not_admin" });

    expect(warned).toHaveLength(1);
  });

  it("writes valid JSON on that single line", () => {
    logRefusal({ operation: "update:clients", reason: "not_found" });

    const [raw] = warned;

    expect(() => JSON.parse(raw) as unknown).not.toThrow();
    expect(raw).not.toContain("\n");
  });

  it("carries the operation, the reason and the timestamp always", () => {
    logRefusal({ operation: "tenantContext.staff", reason: "no_active_org" });

    expect(lines()[0]).toStrictEqual({
      event: "tenant.refusal",
      operation: "tenantContext.staff",
      reason: "no_active_org",
      at: AT,
    });
  });

  it("carries the acting user and organization when they are known", () => {
    logRefusal({
      operation: "delete:projects",
      reason: "not_found",
      userId: "user-row-1",
      orgId: "org-row-1",
    });

    expect(lines()[0]).toStrictEqual({
      event: "tenant.refusal",
      operation: "delete:projects",
      reason: "not_found",
      userId: "user-row-1",
      orgId: "org-row-1",
      at: AT,
    });
  });

  it("omits an unknown identifier rather than writing a null, as a no_session refusal must", () => {
    logRefusal({
      operation: "tenantContext",
      reason: "no_session",
      userId: undefined,
      orgId: undefined,
    });

    const [line] = lines();

    expect(Object.keys(line).sort()).toStrictEqual([
      "at",
      "event",
      "operation",
      "reason",
    ]);
    expect(line).not.toHaveProperty("userId");
    expect(line).not.toHaveProperty("orgId");
  });

  it("carries only one identifier when only one is known", () => {
    logRefusal({
      operation: "tenantContext.contact",
      reason: "no_contact",
      userId: "user-row-1",
    });

    expect(Object.keys(lines()[0]).sort()).toStrictEqual([
      "at",
      "event",
      "operation",
      "reason",
      "userId",
    ]);
  });

  it("only lets the four declared fields into the line, by type", () => {
    logRefusal({
      operation: "update:invoices",
      reason: "not_found",
      // @ts-expect-error `RefusalDetails` has no room for row data. This is a
      // type level guarantee, not a runtime filter: the line below would
      // otherwise be emitted as written, so the compiler is what keeps row
      // contents out of the logs (AC-15).
      email: "person@example.com",
    });

    expect(warned).toHaveLength(1);
  });

  it("emits nothing beyond the declared fields for an ordinary call", () => {
    logRefusal({
      operation: "update:invoices",
      reason: "not_found",
      userId: "user-row-1",
      orgId: "org-row-1",
    });

    expect(Object.keys(lines()[0]).sort()).toStrictEqual([
      "at",
      "event",
      "operation",
      "orgId",
      "reason",
      "userId",
    ]);
  });

  it("stamps the moment it was called, in ISO 8601", () => {
    logRefusal({ operation: "requireStaff", reason: "not_staff" });

    expect(lines()[0].at).toBe(AT);
  });
});

describe("logSystemAccess", () => {
  it("names the fixed operation and the caller's reason", () => {
    logSystemAccess("stripe webhook: no session to resolve");

    expect(warned).toHaveLength(1);
    expect(lines()[0]).toStrictEqual({
      event: "tenant.system_access",
      operation: "withSystemAccess",
      reason: "stripe webhook: no session to resolve",
      at: AT,
    });
  });

  it("carries no identifiers, because a system caller has no tenant", () => {
    logSystemAccess("daily cron: sweeps every organization");

    const [line] = lines();

    expect(line).not.toHaveProperty("userId");
    expect(line).not.toHaveProperty("orgId");
  });
});

describe("logEscapeHatch", () => {
  it("is its own event, so hand written queries can be counted separately", () => {
    logEscapeHatch({
      operation: "unsafeTenantQuery",
      reason: "aggregate the accessor cannot express",
      userId: "user-row-1",
      orgId: "org-row-1",
    });

    expect(warned).toHaveLength(1);
    expect(lines()[0]).toStrictEqual({
      event: "tenant.escape_hatch",
      operation: "unsafeTenantQuery",
      reason: "aggregate the accessor cannot express",
      userId: "user-row-1",
      orgId: "org-row-1",
      at: AT,
    });
  });

  it("is not counted as a refusal", () => {
    logEscapeHatch({ operation: "unsafeTenantQuery", reason: "a report" });

    expect(lines()[0].event).not.toBe("tenant.refusal");
  });
});

describe("the three events together", () => {
  it("use three distinct event names, so a log query can tell them apart", () => {
    logRefusal({ operation: "requireStaff", reason: "not_staff" });
    logSystemAccess("clerk webhook");
    logEscapeHatch({ operation: "unsafeTenantQuery", reason: "a report" });

    expect(lines().map((line) => line.event)).toStrictEqual([
      "tenant.refusal",
      "tenant.system_access",
      "tenant.escape_hatch",
    ]);
  });
});
