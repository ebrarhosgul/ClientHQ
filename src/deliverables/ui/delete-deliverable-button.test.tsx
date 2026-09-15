/**
 * covers: spec 0011 AC-15
 *
 * `ConfirmDialog` has its own render and interaction tests; this file is only
 * about what `DeleteDeliverableButton` hands it, and the `onConfirm` callback
 * that calls `deleteDeliverable` and refreshes on success.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteDeliverable: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../delete-deliverable", () => ({
  deleteDeliverable: mocks.deleteDeliverable,
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

const { DeleteDeliverableButton } = await import("./delete-deliverable-button");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("DeleteDeliverableButton", () => {
  it("shows the trigger and asks for confirmation with the file's name", () => {
    render(<DeleteDeliverableButton deliverableId="d1" name="Contract.pdf" />);

    expect(
      screen.getByRole("button", { name: "Delete Contract.pdf" }),
    ).toBeInTheDocument();

    const props = mocks.confirmDialogProps[0];
    expect(props.title).toBe("Delete Contract.pdf?");
    expect(props.confirmLabel).toBe("Delete");
    expect(props.variant).toBe("destructive");
  });

  it("deletes and refreshes on a successful confirm (AC-15)", async () => {
    mocks.deleteDeliverable.mockResolvedValue({ ok: true, data: undefined });
    render(<DeleteDeliverableButton deliverableId="d1" name="Contract.pdf" />);

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await onConfirm();

    expect(mocks.deleteDeliverable).toHaveBeenCalledWith({
      deliverableId: "d1",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
  });

  it("reports the failure message without refreshing when the store failed (AC-15)", async () => {
    mocks.deleteDeliverable.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });
    render(<DeleteDeliverableButton deliverableId="d1" name="Contract.pdf" />);

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
