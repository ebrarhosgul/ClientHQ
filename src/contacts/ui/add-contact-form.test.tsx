/**
 * covers: spec 0009 AC-1
 *
 * `addContact` is mocked (it has its own tests in `contacts.db.test.ts`);
 * this file is about the form's own job: a field error (the duplicate email
 * case) renders beside its field and keeps the values typed in, any other
 * error renders as a general alert, and a successful add clears the inputs
 * and refreshes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addContact: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contacts/add-contact", () => ({ addContact: mocks.addContact }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { AddContactForm } = await import("./add-contact-form");

beforeEach(() => {
  vi.clearAllMocks();
});

async function fillAndSubmit(name: string, email: string) {
  const user = userEvent.setup();

  render(<AddContactForm clientId="client-1" />);
  await user.type(screen.getByRole("textbox", { name: /^Name/u }), name);
  await user.type(screen.getByRole("textbox", { name: /^Email/u }), email);
  await user.click(screen.getByRole("button", { name: "Add contact" }));

  return user;
}

describe("AddContactForm", () => {
  it("renders both fields empty and the add button", () => {
    render(<AddContactForm clientId="client-1" />);

    expect(screen.getByRole("textbox", { name: /^Name/u })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /^Email/u })).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Add contact" }),
    ).toBeInTheDocument();
  });

  it("adds the contact and clears the form on success (AC-1)", async () => {
    mocks.addContact.mockResolvedValue({ ok: true, data: { id: "c1" } });

    await fillAndSubmit("Ada Lovelace", "ada@northwind.example");

    expect(mocks.addContact).toHaveBeenCalledWith({
      clientId: "client-1",
      name: "Ada Lovelace",
      email: "ada@northwind.example",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: /^Name/u })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /^Email/u })).toHaveValue("");
  });

  it("shows a duplicate email as a field error and keeps the typed values (AC-1)", async () => {
    mocks.addContact.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "This client already has a contact with that email.",
        fieldErrors: {
          email: ["This client already has a contact with that email."],
        },
      },
    });

    await fillAndSubmit("Ada Lovelace", "ada@northwind.example");

    expect(
      screen.getByText("This client already has a contact with that email."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Name/u })).toHaveValue(
      "Ada Lovelace",
    );
    expect(screen.getByRole("textbox", { name: /^Email/u })).toHaveValue(
      "ada@northwind.example",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows any other failure as a general alert", async () => {
    mocks.addContact.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "Archived clients cannot be edited.",
      },
    });

    await fillAndSubmit("Ada Lovelace", "ada@northwind.example");

    expect(screen.getByRole("alert").textContent).toContain(
      "Archived clients cannot be edited.",
    );
  });
});
