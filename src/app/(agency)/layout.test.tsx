/**
 * covers: spec 0008 AC-12, spec 0005 AC-12
 *
 * The agency layout renders the shell and reads nothing. That is the fail
 * closed half of the gate: Next never routes a layout's own throw to the
 * `error.tsx` beside it, so the first database read of the agency area has to
 * sit one segment lower (the `(gated)` layout, or the `/billing` page) for a
 * failed read to render inside the shell with a way to billing. Regression
 * test for the outage that rendered the root boundary instead: putting
 * `agencyContext()` back up here fails the first case.
 *
 * `AppShell` is stubbed (it has its own tests).
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
  }) => React.ReactElement | Promise<React.ReactElement>;
  return render(await Layout({ children }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ kind: "staff" });
});

describe("AgencyLayout", () => {
  it("never resolves the context itself, even with Clerk configured, so a failed read lands below its error boundary (spec 0008, AC-12)", async () => {
    await renderLayout(<p>page content</p>);

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(screen.getByTestId("app-shell")).toContainElement(
      screen.getByText("page content"),
    );
  });

  it("renders the shell with no Clerk key (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderLayout(<p>page content</p>);

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
