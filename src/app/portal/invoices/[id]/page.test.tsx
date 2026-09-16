/**
 * covers: spec 0012 AC-16
 *
 * The placeholder the issue email's link lands on. `AuthCard` and
 * `AuthFrame` have their own render tests; this file is about which of the
 * two messages `PortalInvoicePlaceholder` shows: it never reads any invoice
 * data itself either way, and it never calls `isClientContact` at all with
 * no Clerk session configured.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  isClientContact: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ isClientContact: mocks.isClientContact }));
// Pure chrome (brand, theme control, footer copy); not this file's concern,
// and `ThemeControl` is an async Client Component that would otherwise
// suspend under `render`.
vi.mock("@/auth/ui/auth-frame", () => ({
  AuthFrame: ({ children }: { readonly children: ReactNode }) => children,
}));

const { default: PortalInvoicePlaceholder } = await import("./page");

async function renderPage() {
  return render(await PortalInvoicePlaceholder());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
});

describe("PortalInvoicePlaceholder", () => {
  it("welcomes a signed in client contact without showing any invoice data (AC-16)", async () => {
    mocks.isClientContact.mockResolvedValue(true);

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Your invoice is on its way here",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("asks a non contact (no session, or staff with no contact row) to sign in as a client contact", async () => {
    mocks.isClientContact.mockResolvedValue(false);

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in as a client contact",
      }),
    ).toBeInTheDocument();
  });

  it("shows the sign in prompt without calling isClientContact when Clerk is not configured", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(mocks.isClientContact).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in as a client contact",
      }),
    ).toBeInTheDocument();
  });
});
