/**
 * covers: spec 0009 AC-9, AC-11
 *
 * `AcceptInvitationCard` has its own render tests; `inspectInvitation`,
 * `clerkUser` and `clerkVerifiedEmails` have theirs. This file is about which
 * of the four states the page resolves to from a token and a session: no
 * Clerk configured, no session, a malformed token, and each `inspectInvitation`
 * outcome mapped onto the card's state.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  sessionClaims: vi.fn(),
  clerkUser: vi.fn(),
  clerkVerifiedEmails: vi.fn(),
  inspectInvitation: vi.fn(),
  parseToken: vi.fn(),
  env: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
  env: mocks.env,
}));
vi.mock("@/db/tenant/session", () => ({
  sessionClaims: mocks.sessionClaims,
}));
vi.mock("@/auth/clerk", () => ({
  clerkUser: mocks.clerkUser,
  clerkVerifiedEmails: mocks.clerkVerifiedEmails,
}));
vi.mock("@/db/tenant", () => ({
  inspectInvitation: mocks.inspectInvitation,
}));
vi.mock("@/contacts/token", () => ({ parseToken: mocks.parseToken }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { readonly children: ReactNode }) => children,
}));
// Pure chrome (brand, theme control, footer copy); not this file's concern.
vi.mock("@/auth/ui/auth-frame", () => ({
  AuthFrame: ({ children }: { readonly children: ReactNode }) => children,
}));

const { default: AcceptInvitationPage } = await import("./page");

async function renderPage(token: string | undefined = "contact-1.abcdef") {
  return render(
    await AcceptInvitationPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ token }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.env.mockReturnValue({
    NEXT_PUBLIC_APP_URL: "https://app.clienthq.example",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  });
  mocks.parseToken.mockReturnValue({
    contactId: "contact-1",
    secret: "abcdef",
  });
  mocks.clerkUser.mockResolvedValue({
    ok: true,
    data: { email: "ada@northwind.example" },
  });
  mocks.clerkVerifiedEmails.mockResolvedValue({
    ok: true,
    data: ["ada@northwind.example"],
  });
});

describe("no Clerk configured", () => {
  it("shows the unavailable panel without reading a session", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(
      screen.getByText("Invitations are not configured"),
    ).toBeInTheDocument();
    expect(mocks.sessionClaims).not.toHaveBeenCalled();
  });
});

describe("no session", () => {
  it("resolves invalid without inspecting the invitation", async () => {
    mocks.sessionClaims.mockResolvedValue({ clerkUserId: undefined });

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation link is not valid",
      }),
    ).toBeInTheDocument();
    expect(mocks.inspectInvitation).not.toHaveBeenCalled();
  });
});

describe("a signed in user", () => {
  beforeEach(() => {
    mocks.sessionClaims.mockResolvedValue({ clerkUserId: "user_1" });
  });

  it("resolves invalid for a malformed token, without inspecting anything", async () => {
    mocks.parseToken.mockReturnValue(undefined);

    await renderPage("garbage");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation link is not valid",
      }),
    ).toBeInTheDocument();
    expect(mocks.inspectInvitation).not.toHaveBeenCalled();
  });

  it("resolves invalid when Clerk cannot answer for the user", async () => {
    mocks.clerkUser.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "" },
    });

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation link is not valid",
      }),
    ).toBeInTheDocument();
  });

  it("resolves acceptable, naming the agency, the client and the signed in email (AC-9)", async () => {
    mocks.inspectInvitation.mockResolvedValue({
      kind: "acceptable",
      agencyName: "Bright & Co",
      clientName: "Northwind Coffee",
    });

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Accept your invitation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bright & Co has invited you to the client portal for Northwind Coffee. You are signed in as ada@northwind.example.",
      ),
    ).toBeInTheDocument();
    expect(mocks.inspectInvitation).toHaveBeenCalledWith({
      token: { contactId: "contact-1", secret: "abcdef" },
      clerkUserId: "user_1",
      verifiedEmails: ["ada@northwind.example"],
    });
  });

  it("resolves already_yours", async () => {
    mocks.inspectInvitation.mockResolvedValue({ kind: "already_yours" });

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "You already accepted this invitation",
      }),
    ).toBeInTheDocument();
  });

  it("resolves wrong_account with a switch account link back through sign in (AC-11)", async () => {
    mocks.inspectInvitation.mockResolvedValue({ kind: "wrong_account" });

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation is for a different email address",
      }),
    ).toBeInTheDocument();
  });

  it("resolves invalid for the invalid outcome", async () => {
    mocks.inspectInvitation.mockResolvedValue({ kind: "invalid" });

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation link is not valid",
      }),
    ).toBeInTheDocument();
  });
});
