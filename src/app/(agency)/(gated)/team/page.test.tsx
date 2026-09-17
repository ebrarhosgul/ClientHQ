/**
 * covers: spec 0015 AC-1, AC-11; spec 0004 AC-22
 *
 * `/team`'s own job, with `TeamPageView` mocked to a prop capture (it has its
 * own tests): with no Clerk key it renders the empty frame rather than
 * resolving a tenant context that cannot exist; otherwise it resolves the
 * agency context and the agency name in parallel, reads the team for that
 * organization, and passes the load failure through as an undefined team
 * rather than falling back to the mirror.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  currentAgency: vi.fn(),
  loadTeam: vi.fn(),
  teamPageViewProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({
  agencyContext: mocks.agencyContext,
  currentAgency: mocks.currentAgency,
}));
vi.mock("@/team/queries", () => ({ loadTeam: mocks.loadTeam }));
vi.mock("@/team/ui/session-sync", () => ({
  ClerkSessionSync: ({ children }: { readonly children: ReactNode }) =>
    children,
}));
vi.mock("@/team/ui/team-page-view", () => ({
  TeamPageView: (props: Record<string, unknown>) => {
    mocks.teamPageViewProps.push(props);
    return <div data-testid="team-page-view" />;
  },
}));

const { default: TeamPage } = await import("./page");

const CTX = {
  kind: "staff",
  orgId: "local-org",
  clerkOrgId: "org_northwind",
  userId: "local-ada",
  clerkUserId: "user_ada",
  role: "admin",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamPageViewProps = [];
});

describe("TeamPage", () => {
  it("renders the empty frame with no session when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(await TeamPage());

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.loadTeam).not.toHaveBeenCalled();
    expect(mocks.teamPageViewProps[0]).toMatchObject({
      agencyName: "your agency",
      clerkOrgId: "",
      viewerClerkUserId: "",
      viewerRole: "member",
      team: undefined,
    });
  });

  it("loads the team for the resolved organization and agency name (AC-1)", async () => {
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.agencyContext.mockResolvedValue(CTX);
    mocks.currentAgency.mockResolvedValue({ name: "Northwind Studio" });
    mocks.loadTeam.mockResolvedValue({
      ok: true,
      team: { members: [], invitations: [] },
    });

    render(await TeamPage());

    expect(mocks.loadTeam).toHaveBeenCalledWith(CTX);
    expect(mocks.teamPageViewProps[0]).toMatchObject({
      agencyName: "Northwind Studio",
      clerkOrgId: "org_northwind",
      viewerClerkUserId: "user_ada",
      viewerRole: "admin",
      team: { members: [], invitations: [] },
    });
    expect(typeof mocks.teamPageViewProps[0].wrap).toBe("function");
  });

  it("falls back to a generic agency name when the mirror has none yet", async () => {
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.agencyContext.mockResolvedValue(CTX);
    mocks.currentAgency.mockResolvedValue(undefined);
    mocks.loadTeam.mockResolvedValue({
      ok: true,
      team: { members: [], invitations: [] },
    });

    render(await TeamPage());

    expect(mocks.teamPageViewProps[0]).toMatchObject({
      agencyName: "your agency",
    });
  });

  it("passes team as undefined, not the mirror, when the Clerk read fails (AC-11)", async () => {
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.agencyContext.mockResolvedValue(CTX);
    mocks.currentAgency.mockResolvedValue({ name: "Northwind Studio" });
    mocks.loadTeam.mockResolvedValue({ ok: false, failure: "unreachable" });

    render(await TeamPage());

    expect(mocks.teamPageViewProps[0]).toMatchObject({ team: undefined });
  });
});
