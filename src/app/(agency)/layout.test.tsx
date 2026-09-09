/**
 * covers: spec 0005 AC-12
 *
 * Every agency section resolves its context here, once, before the shell
 * renders. `AppShell` is stubbed (it has its own tests); this file is about
 * whether `agencyContext()` runs at all, and only when Clerk is configured
 * (spec 0004, AC-22: a build with no Clerk key must still render).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/auth/context", () => ({
  agencyContext: mocks.agencyContext,
}));

vi.mock("@/ui/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const { default: AgencyLayout } = await import("./layout");

/** The generated `LayoutProps<"/">` type is not available outside a Next build. */
async function renderLayout(children: React.ReactNode) {
  const Layout = AgencyLayout as unknown as (props: {
    children: React.ReactNode;
  }) => Promise<React.ReactElement>;
  return render(await Layout({ children }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ kind: "staff" });
});

describe("AgencyLayout", () => {
  it("resolves the agency context before rendering the shell (AC-12)", async () => {
    await renderLayout(<p>page content</p>);

    expect(mocks.agencyContext).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-shell")).toContainElement(
      screen.getByText("page content"),
    );
  });

  it("skips context resolution entirely with no Clerk key (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderLayout(<p>page content</p>);

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
