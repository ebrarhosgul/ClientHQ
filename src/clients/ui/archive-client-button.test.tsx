/**
 * covers: spec 0006 AC-8
 *
 * `ConfirmDialog` has its own render and interaction tests in
 * `src/ui/patterns/patterns.test.tsx`; this file is only about what
 * `ArchiveClientButton` hands it: the confirmation copy, and the `onConfirm`
 * callback that calls `archiveClient` and refreshes on success.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveClient: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/clients/archive-client", () => ({
  archiveClient: mocks.archiveClient,
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

const { ArchiveClientButton } = await import("./archive-client-button");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("ArchiveClientButton", () => {
  it("shows the trigger and asks for confirmation with the client's name (AC-8)", () => {
    render(<ArchiveClientButton clientId="c1" clientName="Northwind" />);

    expect(
      screen.getByRole("button", { name: /archive/i }),
    ).toBeInTheDocument();

    const props = mocks.confirmDialogProps[0];
    expect(props.title).toBe("Archive Northwind?");
    expect(props.confirmLabel).toBe("Archive");
    expect(props.variant).toBe("destructive");
  });

  it("archives and refreshes on a successful confirm", async () => {
    mocks.archiveClient.mockResolvedValue({
      ok: true,
      data: { archivedAt: new Date() },
    });
    render(<ArchiveClientButton clientId="c1" clientName="Northwind" />);

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await onConfirm();

    expect(mocks.archiveClient).toHaveBeenCalledWith({ id: "c1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
  });

  it("reports the failure message without refreshing when the action fails", async () => {
    mocks.archiveClient.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "" },
    });
    render(<ArchiveClientButton clientId="c1" clientName="Northwind" />);

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
      readonly message?: string;
    }>;
    const result = await onConfirm();

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toEqual(expect.any(String));
  });
});
