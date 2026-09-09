/**
 * covers: spec 0005 AC-1, AC-16
 *
 * Signing up, on this product's own route. `@clerk/nextjs`'s `SignUp` is
 * stubbed: this file is about the two guards around it, not about Clerk's own
 * card.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  claims: { clerkOrgId: undefined as string | undefined },
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirected.push(path);
    throw new Error(REDIRECTED);
  },
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/db/tenant/session", () => ({
  sessionClaims: async () => mocks.claims,
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: () => <div data-testid="clerk-sign-up" />,
}));

const { default: SignUpPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirected.length = 0;
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.claims = { clerkOrgId: undefined };
});

describe("SignUpPage", () => {
  it("shows the unavailable panel when Clerk has no credentials", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(await SignUpPage());

    expect(screen.getByText("Sign up is not configured")).toBeInTheDocument();
  });

  it("sends someone already inside an agency to /dashboard (AC-16)", async () => {
    mocks.claims = { clerkOrgId: "org_1" };

    await expect(SignUpPage()).rejects.toThrow(REDIRECTED);
    expect(mocks.redirected).toEqual(["/dashboard"]);
  });

  it("renders Clerk's sign up card for a signed out visitor (AC-1)", async () => {
    render(await SignUpPage());

    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });
});
