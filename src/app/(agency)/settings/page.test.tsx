/**
 * covers: spec 0004 AC-22
 *
 * `/settings`' own job, with `SettingsView` mocked to a prop capture (it has
 * its own tests): with no Clerk key it renders the "could not be loaded" state
 * without resolving a tenant context; otherwise it reads the acting agency's
 * own settings through the context and hands them to the view.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  agencySettings: vi.fn(),
  viewProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/db/tenant", () => ({ agencySettings: mocks.agencySettings }));
vi.mock("@/settings/ui/settings-view", () => ({
  SettingsView: (props: Record<string, unknown>) => {
    mocks.viewProps.push(props);
    return <div data-testid="settings-view" />;
  },
}));

const { default: SettingsPage } = await import("./page");

const CTX = {
  kind: "staff",
  orgId: "local-org",
  clerkOrgId: "org_apex",
  userId: "local-sarah",
  clerkUserId: "user_sarah",
  role: "admin",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewProps = [];
});

describe("SettingsPage", () => {
  it("renders the empty state with no session when Clerk has no credentials", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(await SettingsPage());

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.agencySettings).not.toHaveBeenCalled();
    expect(mocks.viewProps[0]).toEqual({ settings: undefined });
  });

  it("reads the acting agency's settings through its own context", async () => {
    const settings = { id: "local-org", name: "Apex Interactive Studio" };
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.agencyContext.mockResolvedValue(CTX);
    mocks.agencySettings.mockResolvedValue(settings);

    render(await SettingsPage());

    expect(mocks.agencySettings).toHaveBeenCalledWith(CTX);
    expect(mocks.viewProps[0]).toEqual({ settings });
  });
});
