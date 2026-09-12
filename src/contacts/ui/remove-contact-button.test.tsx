/**
 * covers: spec 0009 AC-8
 *
 * `ConfirmDialog` has its own render and interaction tests in
 * `src/ui/patterns/patterns.test.tsx`; `removeContact` has its own tests in
 * `contacts.db.test.ts`. This file is only about what `RemoveContactButton`
 * hands the dialog: the confirmation copy differs for an accepted contact,
 * and the `onConfirm` callback that calls `removeContact` and refreshes on
 * success.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeContact: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/contacts/remove-contact", () => ({
  removeContact: mocks.removeContact,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/ui/patterns/confirm-dialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    mocks.confirmDialogProps.push(props);
    return props.trigger;
  },
}));

const { RemoveContactButton } = await import("./remove-contact-button");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("RemoveContactButton", () => {
  it("names the contact in the trigger and the title", () => {
    render(
      <RemoveContactButton contactId="c1" contactName="Ada" accepted={false} />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Ada" }),
    ).toBeInTheDocument();
    expect(mocks.confirmDialogProps[0].title).toBe("Remove Ada?");
    expect(mocks.confirmDialogProps[0].variant).toBe("destructive");
  });

  it("warns about losing portal access when the contact has accepted", () => {
    render(
      <RemoveContactButton contactId="c1" contactName="Ada" accepted={true} />,
    );

    expect(mocks.confirmDialogProps[0].description).toContain(
      "lose access to the client portal",
    );
  });

  it("warns about the invitation link when the contact has not accepted", () => {
    render(
      <RemoveContactButton contactId="c1" contactName="Ada" accepted={false} />,
    );

    expect(mocks.confirmDialogProps[0].description).toContain(
      "invitation link they were sent stops working",
    );
  });

  it("removes and refreshes on a successful confirm", async () => {
    mocks.removeContact.mockResolvedValue({ ok: true, data: { id: "c1" } });
    render(
      <RemoveContactButton contactId="c1" contactName="Ada" accepted={false} />,
    );

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await onConfirm();

    expect(mocks.removeContact).toHaveBeenCalledWith({ contactId: "c1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
  });

  it("reports the failure message without refreshing when the action fails", async () => {
    mocks.removeContact.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });
    render(
      <RemoveContactButton contactId="c1" contactName="Ada" accepted={false} />,
    );

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
      readonly message?: ReactNode;
    }>;
    const result = await onConfirm();

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);

    render(<p role="alert">{result.message}</p>);
    expect(screen.getByRole("alert").textContent).not.toBe("");
  });
});
