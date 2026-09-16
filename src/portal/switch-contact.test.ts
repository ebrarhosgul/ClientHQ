/**
 * @vitest-environment node
 *
 * covers: spec 0014 AC-11
 *
 * `switchContact` with its two reads and the cookie jar mocked, and `redirect`
 * and `failure` left real (from `@/db/tenant/errors`), so the assertions are
 * against the actual `Result` shape and the actual `NEXT_REDIRECT` signal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext } from "@/db/tenant";

const CONTACT_A1 = "0198a000-0000-7000-8000-0000000000a1";
const CONTACT_B1 = "0198a000-0000-7000-8000-0000000000b1";
const CONTACT_NOT_MINE = "0198a000-0000-7000-8000-0000000000c1";

const CONTACT: ContactContext = {
  kind: "contact",
  orgId: "org-a",
  userId: "user-a1",
  clerkUserId: "clerk-a1",
  clientId: "client-a1",
  contactId: CONTACT_A1,
};

const ROWS = [
  {
    contactId: CONTACT_A1,
    clientId: "client-a1",
    orgId: "org-a",
    clientName: "A1",
    agencyName: "Agency A",
  },
  {
    contactId: CONTACT_B1,
    clientId: "client-b1",
    orgId: "org-b",
    clientName: "B1",
    agencyName: "Agency B",
  },
];

const mocks = vi.hoisted(() => ({
  contactContext: vi.fn(),
  listAcceptedContactRows: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${to}`,
    });
  }),
}));

vi.mock("@/db/tenant/context", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant/context")>();

  return { ...actual, contactContext: mocks.contactContext };
});

vi.mock("@/db/tenant/contact-rows", async (importActual) => {
  const actual =
    await importActual<typeof import("@/db/tenant/contact-rows")>();

  return { ...actual, listAcceptedContactRows: mocks.listAcceptedContactRows };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { switchContact } = await import("./switch-contact");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactContext.mockResolvedValue(CONTACT);
  mocks.listAcceptedContactRows.mockResolvedValue(ROWS);
});

describe("switchContact", () => {
  it("refuses a malformed id without resolving a session", async () => {
    const result = await switchContact({ contactId: "not-a-uuid" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "That is not a client you can switch to.",
      },
    });
    expect(mocks.contactContext).not.toHaveBeenCalled();
  });

  it("sets the cookie and redirects to /portal for one of this person's own rows", async () => {
    await expect(switchContact({ contactId: CONTACT_B1 })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "clienthq_contact",
      CONTACT_B1,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/portal");
  });

  it("refuses an id not among this person's accepted rows, and sets no cookie", async () => {
    const result = await switchContact({ contactId: CONTACT_NOT_MINE });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "That client is no longer available to you.",
      },
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("writes the exact refusal shape spec 0014 AC-11 fixes, and only on refusal", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await switchContact({ contactId: CONTACT_NOT_MINE });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(logged).toEqual({
      event: "portal.switch.refused",
      userId: CONTACT.userId,
      at: expect.any(String),
    });

    warnSpy.mockClear();
    await switchContact({ contactId: CONTACT_B1 }).catch(() => undefined);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("reads this person's own rows, not a caller supplied client or org", async () => {
    await switchContact({ contactId: CONTACT_B1 }).catch(() => undefined);

    expect(mocks.listAcceptedContactRows).toHaveBeenCalledWith(CONTACT.userId);
  });
});
