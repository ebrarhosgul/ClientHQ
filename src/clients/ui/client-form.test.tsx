/**
 * covers: spec 0006 AC-1, AC-3, AC-7
 *
 * `createClient` and `updateClient` are mocked (each has its own tests
 * already); this file is about the form's own job: which action it calls in
 * which mode, showing a field error beside its field, keeping the name typed
 * in after a failed submit (AC-3), and navigating to the saved client on
 * success.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientRow } from "@/clients/queries";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/clients/create-client", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/clients/update-client", () => ({
  updateClient: mocks.updateClient,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const { ClientForm } = await import("./client-form");

const CLIENT: ClientRow = {
  id: "client-1",
  orgId: "org-1",
  name: "Northwind Coffee",
  companyEmail: "hello@northwind.example",
  phone: "555-0100",
  industry: "Coffee roasting",
  notes: "Prefers email",
  billingAddressLine1: "1 Main St",
  billingAddressLine2: null,
  billingCity: "Portland",
  billingRegion: "OR",
  billingPostalCode: "97201",
  billingCountry: "USA",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClientForm, creating", () => {
  it("renders every field empty, with the create label", () => {
    render(<ClientForm />);

    expect(screen.getByRole("textbox", { name: /client name/i })).toHaveValue(
      "",
    );
    expect(screen.getByRole("textbox", { name: "Company email" })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("group", { name: "Billing address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create client" }),
    ).toBeInTheDocument();
  });

  it("creates a client with just a name and navigates to it (AC-1)", async () => {
    const user = userEvent.setup();
    mocks.createClient.mockResolvedValue({ ok: true, data: { id: "new-1" } });

    render(<ClientForm />);
    await user.type(
      screen.getByRole("textbox", { name: /client name/i }),
      "Acme",
    );
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme" }),
    );
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/clients/new-1");
  });

  it("shows a field error beside its field and keeps the name typed in (AC-3)", async () => {
    const user = userEvent.setup();
    mocks.createClient.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
        fieldErrors: { companyEmail: ["Enter a valid email address."] },
      },
    });

    render(<ClientForm />);
    await user.type(
      screen.getByRole("textbox", { name: /client name/i }),
      "Acme",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Company email" }),
      "not-an-email",
    );
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /client name/i })).toHaveValue(
      "Acme",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows a non field failure as an alert", async () => {
    const user = userEvent.setup();
    mocks.createClient.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Try again in a moment." },
    });

    render(<ClientForm />);
    await user.type(
      screen.getByRole("textbox", { name: /client name/i }),
      "Acme",
    );
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Try again in a moment.",
    );
  });
});

describe("ClientForm, editing", () => {
  it("prefills every field from the client, with the save label (AC-7)", () => {
    render(<ClientForm client={CLIENT} />);

    expect(screen.getByRole("textbox", { name: /client name/i })).toHaveValue(
      "Northwind Coffee",
    );
    expect(screen.getByRole("textbox", { name: "Company email" })).toHaveValue(
      "hello@northwind.example",
    );
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue(
      "Portland",
    );
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("turns a null field into an empty string rather than the literal 'null'", () => {
    render(<ClientForm client={CLIENT} />);

    expect(screen.getByRole("textbox", { name: "Address line 2" })).toHaveValue(
      "",
    );
  });

  it("saves an edit through updateClient, carrying the client's id (AC-7)", async () => {
    const user = userEvent.setup();
    mocks.updateClient.mockResolvedValue({
      ok: true,
      data: { id: "client-1" },
    });

    render(<ClientForm client={CLIENT} />);
    await user.clear(screen.getByRole("textbox", { name: /client name/i }));
    await user.type(
      screen.getByRole("textbox", { name: /client name/i }),
      "Renamed",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "client-1", name: "Renamed" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/clients/client-1");
  });
});
