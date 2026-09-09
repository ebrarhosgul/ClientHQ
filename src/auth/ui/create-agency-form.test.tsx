/**
 * covers: spec 0005 AC-8, AC-9, AC-18
 *
 * The one field that creates an agency. `createAgency` (the Server Action) and
 * `useActivateAgency` are both mocked: this component's own job is showing the
 * field error beside the field rather than only in a toast (AC-18), showing a
 * non field failure as an alert, and awaiting activation before it navigates
 * (AC-9). All three have their own tests already.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgency: vi.fn(),
  activate: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/auth/agency", () => ({
  createAgency: mocks.createAgency,
}));

vi.mock("./use-activate-agency", () => ({
  useActivateAgency: () => ({
    ready: true,
    state: "idle",
    activate: mocks.activate,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

const { CreateAgencyForm } = await import("./create-agency-form");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activate.mockResolvedValue(undefined);
});

describe("CreateAgencyForm", () => {
  it("renders the one field the spec promises", () => {
    render(<CreateAgencyForm />);

    expect(
      screen.getByRole("textbox", { name: /agency name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create agency" }),
    ).toBeInTheDocument();
  });

  it("shows a field error beside the field, not only in a toast (AC-8, AC-18)", async () => {
    const user = userEvent.setup();
    mocks.createAgency.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
        fieldErrors: { name: ["Enter your agency's name."] },
      },
    });

    render(<CreateAgencyForm />);
    // The field carries HTML's own `required`, so a value is typed here purely
    // to get past that and exercise the server's mocked validation failure,
    // which is the thing this test is about.
    await user.type(screen.getByRole("textbox", { name: /agency name/i }), " ");
    await user.click(screen.getByRole("button", { name: "Create agency" }));

    expect(
      await screen.findByText("Enter your agency's name."),
    ).toBeInTheDocument();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("shows a non field failure as an alert, with the mapped message", async () => {
    const user = userEvent.setup();
    mocks.createAgency.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Try again in a moment." },
    });

    render(<CreateAgencyForm />);
    await user.type(
      screen.getByRole("textbox", { name: /agency name/i }),
      "Northwind",
    );
    await user.click(screen.getByRole("button", { name: "Create agency" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try again in a moment.");
  });

  it("does not blank the field after a failed submit", async () => {
    const user = userEvent.setup();
    mocks.createAgency.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Try again in a moment." },
    });

    render(<CreateAgencyForm />);
    const input = screen.getByRole("textbox", { name: /agency name/i });
    await user.type(input, "Northwind");
    await user.click(screen.getByRole("button", { name: "Create agency" }));

    await screen.findByRole("alert");
    expect(input).toHaveValue("Northwind");
  });

  it("activates the agency and only then navigates to the dashboard (AC-9)", async () => {
    const user = userEvent.setup();
    mocks.createAgency.mockResolvedValue({
      ok: true,
      data: { clerkOrgId: "org_new", alreadyExisted: false },
    });

    render(<CreateAgencyForm />);
    await user.type(
      screen.getByRole("textbox", { name: /agency name/i }),
      "Northwind",
    );
    await user.click(screen.getByRole("button", { name: "Create agency" }));

    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("org_new"));
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });
});
