/**
 * covers: spec 0005 AC-1, AC-2, AC-6, AC-7
 *
 * The junction every signed in person passes through. Four outcomes, decided
 * in a fixed order, and this is where that order is pinned: one membership
 * activates itself, several offer a picker, none plus an accepted client
 * contact goes to the portal, and none at all offers to create an agency. The
 * child components each have their own tests, so they are stubbed here to keep
 * this file about the branching alone.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  claims: { clerkUserId: "user_1" as string | undefined },
  agencyMemberships: vi.fn(),
  isClientContact: vi.fn(),
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

vi.mock("@/auth/clerk", () => ({
  agencyMemberships: mocks.agencyMemberships,
}));

vi.mock("@/auth/context", () => ({
  isClientContact: mocks.isClientContact,
}));

vi.mock("@/db/tenant", () => ({
  toMembershipRole: (role: string | undefined) =>
    role === "org:admin" ? "admin" : "member",
}));

vi.mock("@/auth/ui/activate-agency", () => ({
  ActivateAgency: ({
    clerkOrgId,
    name,
  }: {
    clerkOrgId: string;
    name: string;
  }) => <div data-testid="activate-agency">{`${name}:${clerkOrgId}`}</div>,
}));

vi.mock("@/auth/ui/agency-picker", () => ({
  AgencyPicker: ({
    agencies,
  }: {
    agencies: readonly { clerkOrgId: string; name: string; isAdmin: boolean }[];
  }) => (
    <ul data-testid="agency-picker">
      {agencies.map((agency) => (
        <li key={agency.clerkOrgId}>{`${agency.name}:${agency.isAdmin}`}</li>
      ))}
    </ul>
  ),
}));

vi.mock("@/auth/ui/create-agency-form", () => ({
  CreateAgencyForm: () => <div data-testid="create-agency-form" />,
}));

const { default: OnboardingPage } = await import("./page");

async function renderPage() {
  return render(await OnboardingPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirected.length = 0;
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.claims = { clerkUserId: "user_1" };
  mocks.agencyMemberships.mockResolvedValue([]);
  mocks.isClientContact.mockResolvedValue(false);
});

describe("OnboardingPage", () => {
  it("shows the unavailable panel when Clerk has no credentials (AC-2)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(screen.getByText("Setup is not configured")).toBeInTheDocument();
    expect(mocks.agencyMemberships).not.toHaveBeenCalled();
  });

  it("sends a signed out visitor to /sign-in", async () => {
    mocks.claims = { clerkUserId: undefined };

    await expect(renderPage()).rejects.toThrow(REDIRECTED);
    expect(mocks.redirected).toEqual(["/sign-in"]);
  });

  it("opens the one agency itself, with no picker (AC-6)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      { clerkOrgId: "org_1", name: "Northwind", clerkOrgRole: "org:admin" },
    ]);

    await renderPage();

    expect(screen.getByTestId("activate-agency")).toHaveTextContent(
      "Northwind:org_1",
    );
    expect(screen.queryByTestId("agency-picker")).not.toBeInTheDocument();
  });

  it("offers a picker naming each role when there is more than one (AC-6)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      { clerkOrgId: "org_1", name: "Northwind", clerkOrgRole: "org:admin" },
      { clerkOrgId: "org_2", name: "Contoso", clerkOrgRole: "org:member" },
    ]);

    await renderPage();

    const picker = screen.getByTestId("agency-picker");
    expect(picker).toHaveTextContent("Northwind:true");
    expect(picker).toHaveTextContent("Contoso:false");
  });

  it("sends an accepted client contact with no membership to /portal (AC-7)", async () => {
    mocks.agencyMemberships.mockResolvedValue([]);
    mocks.isClientContact.mockResolvedValue(true);

    await expect(renderPage()).rejects.toThrow(REDIRECTED);
    expect(mocks.redirected).toEqual(["/portal"]);
  });

  it("offers to create an agency for someone who is neither staff nor a contact", async () => {
    mocks.agencyMemberships.mockResolvedValue([]);
    mocks.isClientContact.mockResolvedValue(false);

    await renderPage();

    expect(screen.getByTestId("create-agency-form")).toBeInTheDocument();
  });
});
