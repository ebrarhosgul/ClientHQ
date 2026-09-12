/**
 * covers: spec 0008 AC-4, AC-5, AC-12, AC-13
 *
 * The gate as a layout: pass through with no Clerk key, redirect on the two
 * levels that cannot read, the banner on grace, nothing on full, and a throw
 * that is left to propagate. `GraceBanner` is stubbed (it has its own tests);
 * this file is about which of the four things the layout does.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyAccess: vi.fn(),
  redirect: vi.fn(),
  bannerProps: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/access/gate", () => ({
  agencyAccess: mocks.agencyAccess,
}));

vi.mock("@/access/ui/grace-banner", () => ({
  GraceBanner: (props: Record<string, unknown>) => {
    mocks.bannerProps.push(props);

    return <div data-testid="grace-banner" />;
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(REDIRECTED);
  },
}));

const { default: GatedLayout } = await import("./layout");

/** The generated `LayoutProps<"/">` type is not available outside a Next build. */
async function renderLayout(children: React.ReactNode) {
  const Layout = GatedLayout as unknown as (props: {
    children: React.ReactNode;
  }) => Promise<React.ReactNode>;

  return render(<>{await Layout({ children })}</>);
}

const GRACE_ENDS = new Date("2026-09-18T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bannerProps.length = 0;
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyAccess.mockResolvedValue({ level: "full", role: "admin" });
});

describe("GatedLayout", () => {
  it("returns its children untouched with no Clerk key, without reading the level (AC-13)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderLayout(<p>page content</p>);

    expect(mocks.agencyAccess).not.toHaveBeenCalled();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByTestId("grace-banner")).not.toBeInTheDocument();
  });

  it("renders the page and nothing else on full", async () => {
    await renderLayout(<p>page content</p>);

    expect(mocks.agencyAccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByTestId("grace-banner")).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["unsubscribed", "locked"])(
    "redirects to /billing on %s, rendering nothing (AC-4)",
    async (level) => {
      mocks.agencyAccess.mockResolvedValue({ level, role: "admin" });

      await expect(renderLayout(<p>page content</p>)).rejects.toThrow(
        REDIRECTED,
      );

      expect(mocks.redirect).toHaveBeenCalledWith("/billing");
      expect(screen.queryByText("page content")).not.toBeInTheDocument();
    },
  );

  it.each(["admin", "member"])(
    "renders the banner above the page on grace, for a %s (AC-5)",
    async (role) => {
      mocks.agencyAccess.mockResolvedValue({
        level: "grace",
        graceEndsAt: GRACE_ENDS,
        role,
      });

      await renderLayout(<p>page content</p>);

      const banner = screen.getByTestId("grace-banner");
      const content = screen.getByText("page content");

      expect(mocks.bannerProps).toStrictEqual([
        { graceEndsAt: GRACE_ENDS, role },
      ]);
      expect(
        banner.compareDocumentPosition(content) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("lets a failed read propagate so no page renders on an unknown level (AC-12)", async () => {
    const outage = new Error("connection refused");
    mocks.agencyAccess.mockRejectedValue(outage);

    await expect(renderLayout(<p>page content</p>)).rejects.toBe(outage);
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
  });
});
