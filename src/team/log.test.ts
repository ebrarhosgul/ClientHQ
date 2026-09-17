/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-13
 *
 * `logTeamEvent`: one JSON line per call, on `console.info` or `console.error`
 * depending on the level, carrying the operation, the outcome, the org and
 * actor ids, and only the optional fields that were actually passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logTeamEvent } from "./log";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function loggedLine(spy: ReturnType<typeof vi.spyOn>) {
  const [line] = spy.mock.calls[0] as [string];

  return JSON.parse(line) as Record<string, unknown>;
}

describe("logTeamEvent", () => {
  it("writes one console.info line at the default level", () => {
    logTeamEvent({
      operation: "invite",
      outcome: "ok",
      orgId: "org_northwind",
      actorUserId: "user_ada",
    });

    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();

    const line = loggedLine(console.info as ReturnType<typeof vi.spyOn>);

    expect(line).toMatchObject({
      event: "team.management",
      level: "info",
      operation: "invite",
      outcome: "ok",
      orgId: "org_northwind",
      actorUserId: "user_ada",
      at: "2026-09-17T12:00:00.000Z",
    });
  });

  it("writes to console.error when the level is error", () => {
    logTeamEvent(
      {
        operation: "change_role",
        outcome: "mirror_failed",
        orgId: "org_northwind",
        actorUserId: "user_ada",
        membershipId: "orgmem_1",
      },
      "error",
    );

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();

    const line = loggedLine(console.error as ReturnType<typeof vi.spyOn>);

    expect(line.level).toBe("error");
    expect(line.membershipId).toBe("orgmem_1");
  });

  it("carries the target and the role when the operation has them", () => {
    logTeamEvent({
      operation: "invite",
      outcome: "ok",
      orgId: "org_northwind",
      actorUserId: "user_ada",
      invitationId: "orginv_1",
      role: "admin",
    });

    const line = loggedLine(console.info as ReturnType<typeof vi.spyOn>);

    expect(line).toMatchObject({ invitationId: "orginv_1", role: "admin" });
    expect(line).not.toHaveProperty("membershipId");
    expect(line).not.toHaveProperty("targetClerkUserId");
  });

  it("drops every optional field that was not passed rather than writing null", () => {
    logTeamEvent({
      operation: "invite",
      outcome: "invalid",
      orgId: "org_northwind",
      actorUserId: "user_ada",
    });

    const line = loggedLine(console.info as ReturnType<typeof vi.spyOn>);

    expect(Object.keys(line).sort()).toStrictEqual(
      [
        "actorUserId",
        "at",
        "event",
        "level",
        "operation",
        "orgId",
        "outcome",
      ].sort(),
    );
  });

  it("never has an email address anywhere in the logged line (AC-13)", () => {
    logTeamEvent({
      operation: "remove",
      outcome: "ok",
      orgId: "org_northwind",
      actorUserId: "user_ada",
      membershipId: "orgmem_3",
      targetClerkUserId: "user_grace",
    });

    const [line] = (console.info as ReturnType<typeof vi.spyOn>).mock
      .calls[0] as [string];

    expect(line).not.toContain("@");
  });
});
