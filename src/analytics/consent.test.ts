/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-17
 *
 * The one write consent has. No database, no session: a signed out visitor
 * on the sign in page has to be able to decline, so this is exercised with
 * only `next/headers` mocked, the same shape as `src/ui/theme-action.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => jar }));

const { setCookieConsent } = await import("./consent");

beforeEach(() => {
  jar.set.mockClear();
  jar.delete.mockClear();
});

describe("setCookieConsent", () => {
  it.each(["accepted", "declined"] as const)(
    "writes %s to the first party cookie",
    async (choice) => {
      const result = await setCookieConsent(choice);

      expect(result).toEqual({ ok: true, data: { consent: choice } });
      expect(jar.set).toHaveBeenCalledWith(
        "clienthq_consent",
        choice,
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        }),
      );
    },
  );

  it("deletes the cookie for undecided rather than storing the word", async () => {
    const result = await setCookieConsent("undecided");

    expect(result).toEqual({ ok: true, data: { consent: "undecided" } });
    expect(jar.delete).toHaveBeenCalledWith("clienthq_consent");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a choice this form knows", async () => {
    const result = await setCookieConsent("maybe");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "That is not a choice this form knows.",
      },
    });
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 42, {}, ["accepted"]])(
    "refuses a shape that is not a string, such as %j",
    async (value) => {
      const result = await setCookieConsent(value);

      expect(result.ok).toBe(false);
      expect(jar.set).not.toHaveBeenCalled();
      expect(jar.delete).not.toHaveBeenCalled();
    },
  );
});
