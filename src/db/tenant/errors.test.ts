/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-6, AC-9 (the two error vocabularies, and the fact that
 * both are closed sets a caller can switch on exhaustively)
 *
 * The point of this file is the boundary between the two vocabularies. A
 * resolution failure is thrown and must never be mistaken for a business
 * outcome; a `TenantActionError` is a business outcome and must never be
 * mistaken for an unexpected crash. Both guards are used instead of
 * `instanceof`, so both have to be exact about what they accept.
 */
import { describe, expect, it } from "vitest";

import {
  ACTION_ERROR_CODES,
  RESOLUTION_ERROR_KINDS,
  failure,
  isTenantActionError,
  isTenantResolutionError,
  ok,
  tenantActionError,
  tenantResolutionError,
  type ActionErrorCode,
  type ResolutionErrorKind,
} from "./errors";

describe("RESOLUTION_ERROR_KINDS", () => {
  it("is the closed set feature 6 routes on", () => {
    expect([...RESOLUTION_ERROR_KINDS]).toStrictEqual([
      "no_session",
      "no_active_org",
      "no_mirror_row",
      "no_contact",
    ]);
  });
});

describe("ACTION_ERROR_CODES", () => {
  it("is the closed set the UI switches on", () => {
    expect([...ACTION_ERROR_CODES]).toStrictEqual([
      "validation",
      "unauthenticated",
      "not_found",
      "forbidden",
      "conflict",
      "rate_limited",
      "unavailable",
    ]);
  });

  it("is exhaustively switchable, so a new code cannot be added silently", () => {
    // If a code joins the union without joining this switch, the `never`
    // assignment stops compiling. That is the compile time half of AC-9.
    const describeCode = (code: ActionErrorCode): string => {
      switch (code) {
        case "validation":
          return "the input was rejected";
        case "unauthenticated":
          return "nobody is signed in";
        case "not_found":
          return "no such row for this tenant";
        case "forbidden":
          return "the role is not allowed";
        case "conflict":
          return "the row already exists";
        case "rate_limited":
          return "too many attempts";
        case "unavailable":
          return "the mirror row has not landed";
        default: {
          const exhaustive: never = code;
          return exhaustive;
        }
      }
    };

    expect(ACTION_ERROR_CODES.map(describeCode)).toHaveLength(
      ACTION_ERROR_CODES.length,
    );
  });
});

describe("tenantResolutionError", () => {
  it.each(RESOLUTION_ERROR_KINDS)("carries the %s kind", (kind) => {
    const error = tenantResolutionError(kind);

    expect(error.kind).toBe(kind);
    expect(error.name).toBe("TenantResolutionError");
    expect(error).toBeInstanceOf(Error);
  });

  it("names the kind in the message and nothing else", () => {
    const error = tenantResolutionError("no_mirror_row");

    expect(error.message).toBe("tenant resolution failed: no_mirror_row");
  });
});

describe("isTenantResolutionError", () => {
  it.each(RESOLUTION_ERROR_KINDS)("recognises a %s failure", (kind) => {
    expect(isTenantResolutionError(tenantResolutionError(kind))).toBe(true);
  });

  it("rejects an ordinary error, so a crash is never routed as a refusal", () => {
    expect(isTenantResolutionError(new Error("connection reset"))).toBe(false);
    expect(
      isTenantResolutionError(new TypeError("undefined is not a fn")),
    ).toBe(false);
  });

  it("rejects an error carrying a kind this build has never heard of", () => {
    const impostor = Object.assign(new Error("nope"), { kind: "no_such_kind" });

    expect(isTenantResolutionError(impostor)).toBe(false);
  });

  it("rejects a plain object that merely looks the part", () => {
    expect(isTenantResolutionError({ kind: "no_session" })).toBe(false);
  });

  it.each([undefined, "no_session", 42])("rejects %o", (value) => {
    expect(isTenantResolutionError(value)).toBe(false);
  });

  it("does not recognise an action error, which is the other vocabulary", () => {
    const action = tenantActionError({ code: "forbidden", message: "No." });

    expect(isTenantResolutionError(action)).toBe(false);
  });
});

describe("ok and failure", () => {
  it("wraps data as a success a caller can narrow on", () => {
    const result = ok({ id: "row-1" });

    expect(result).toStrictEqual({ ok: true, data: { id: "row-1" } });
  });

  it("carries undefined data as a success, not a failure", () => {
    const result = ok(undefined);

    expect(result.ok).toBe(true);
  });

  it("wraps an error as a failure", () => {
    const error = { code: "not_found", message: "No such client." } as const;

    expect(failure(error)).toStrictEqual({ ok: false, error });
  });

  it("keeps field errors on a validation failure", () => {
    const result = failure({
      code: "validation",
      message: "Check the form.",
      fieldErrors: { name: ["Required"] },
    });

    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: "validation",
        message: "Check the form.",
        fieldErrors: { name: ["Required"] },
      },
    });
  });
});

describe("tenantActionError", () => {
  it("carries the Result the wrapper should hand back", () => {
    const error = tenantActionError({
      code: "forbidden",
      message: "You do not have permission to do that.",
    });

    expect(error.error).toStrictEqual({
      code: "forbidden",
      message: "You do not have permission to do that.",
    });
    expect(error.name).toBe("TenantActionError");
  });

  it("puts the code and the message in the thrown message, for the log", () => {
    const error = tenantActionError({ code: "conflict", message: "Taken." });

    expect(error.message).toBe("conflict: Taken.");
  });
});

describe("isTenantActionError", () => {
  it("recognises a deliberate refusal", () => {
    const error = tenantActionError({ code: "not_found", message: "Gone." });

    expect(isTenantActionError(error)).toBe(true);
  });

  it("rejects an unexpected exception, which must propagate untouched", () => {
    expect(isTenantActionError(new Error("socket hang up"))).toBe(false);
  });

  it("rejects an error whose error field is not an object", () => {
    const impostor = Object.assign(new Error("nope"), { error: "forbidden" });

    expect(isTenantActionError(impostor)).toBe(false);
  });

  it("rejects a plain object that merely looks the part", () => {
    expect(
      isTenantActionError({ error: { code: "forbidden", message: "No." } }),
    ).toBe(false);
  });

  it("does not recognise a resolution failure, which is the other vocabulary", () => {
    const resolution: ResolutionErrorKind = "no_session";

    expect(isTenantActionError(tenantResolutionError(resolution))).toBe(false);
  });
});
