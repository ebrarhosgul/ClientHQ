/**
 * covers: spec 0006 AC-1, spec 0004 AC-22
 *
 * With no Clerk publishable key there is no session to stamp a new row's
 * org_id with, so this shows the sign in prompt rather than a form that could
 * only ever fail.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isClerkConfigured: vi.fn() }));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/clients/ui/client-form", () => ({
  ClientForm: () => <div data-testid="client-form" />,
}));

const { default: NewClientPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewClientPage", () => {
  it("shows the create form when Clerk is configured (AC-1)", () => {
    mocks.isClerkConfigured.mockReturnValue(true);

    render(<NewClientPage />);

    expect(screen.getByTestId("client-form")).toBeInTheDocument();
    expect(
      screen.queryByText("Sign in to create a client"),
    ).not.toBeInTheDocument();
  });

  it("shows a sign in prompt instead of a form with no Clerk credentials (spec 0004, AC-22)", () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(<NewClientPage />);

    expect(screen.queryByTestId("client-form")).not.toBeInTheDocument();
    expect(screen.getByText("Sign in to create a client")).toBeInTheDocument();
  });

  it("gives the page its one heading either way", () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(<NewClientPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "New client" }),
    ).toBeInTheDocument();
  });
});
