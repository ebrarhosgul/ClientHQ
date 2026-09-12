/**
 * covers: spec 0009 AC-2
 *
 * `updateContact` is mocked (it has its own tests in `contacts.db.test.ts`);
 * this file is about the dialog's own job: the email field is read only and
 * explained for an accepted contact, the warning copy for a pending
 * invitation, and that a successful save closes the dialog and refreshes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateContact: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contacts/update-contact", () => ({
  updateContact: mocks.updateContact,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { EditContactDialog } = await import("./edit-contact-dialog");

beforeEach(() => {
  vi.clearAllMocks();
});

async function openDialog(
  props: Partial<Parameters<typeof EditContactDialog>[0]> = {},
) {
  const user = userEvent.setup();

  render(
    <EditContactDialog
      contactId="c1"
      name="Ada Lovelace"
      email="ada@northwind.example"
      accepted={false}
      pending={false}
      {...props}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Edit Ada Lovelace" }));

  return user;
}

describe("EditContactDialog, not invited or unsent", () => {
  it("opens with both fields editable and no warning", async () => {
    await openDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Name/u })).not.toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByRole("textbox", { name: /^Email/u }),
    ).not.toHaveAttribute("readonly");
    expect(
      screen.getByText("Update the name or email address on file."),
    ).toBeInTheDocument();
  });
});

describe("EditContactDialog, pending", () => {
  it("warns that changing the email cancels the invitation", async () => {
    await openDialog({ pending: true });

    expect(
      screen.getByText(/changing the email address cancels the invitation/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /^Email/u }),
    ).not.toHaveAttribute("readonly");
  });
});

describe("EditContactDialog, accepted", () => {
  it("makes the email field read only and explains why (AC-2)", async () => {
    await openDialog({ accepted: true });

    expect(screen.getByRole("textbox", { name: /^Email/u })).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByText(/their email address is fixed/iu),
    ).toBeInTheDocument();
  });

  it("still submits the unchanged email alongside a new name", async () => {
    mocks.updateContact.mockResolvedValue({ ok: true, data: {} });
    const user = await openDialog({ accepted: true });

    const nameInput = screen.getByRole("textbox", { name: /^Name/u });
    await user.clear(nameInput);
    await user.type(nameInput, "Ada L.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateContact).toHaveBeenCalledWith({
      contactId: "c1",
      name: "Ada L.",
      email: "ada@northwind.example",
    });
  });
});

describe("EditContactDialog, saving", () => {
  it("closes the dialog and refreshes on success", async () => {
    mocks.updateContact.mockResolvedValue({ ok: true, data: {} });
    const user = await openDialog();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the error on failure", async () => {
    mocks.updateContact.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message:
          "Someone changed this while you were working. Reload and try again.",
      },
    });
    const user = await openDialog();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Someone changed this while you were working. Reload and try again.",
    );
  });
});
