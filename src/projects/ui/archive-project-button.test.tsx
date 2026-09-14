/**
 * covers: spec 0010 AC-11
 *
 * `ConfirmDialog` has its own render and interaction tests; this file is only
 * about what `ArchiveProjectButton` hands it, and the `onConfirm` callback
 * that calls `archiveProject` and refreshes on success.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../archive-project", () => ({
  archiveProject: mocks.archiveProject,
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

const { ArchiveProjectButton } = await import("./archive-project-button");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("ArchiveProjectButton", () => {
  it("shows the trigger and asks for confirmation with the project's name", () => {
    render(
      <ArchiveProjectButton projectId="p1" projectName="Website relaunch" />,
    );

    expect(
      screen.getByRole("button", { name: /archive/i }),
    ).toBeInTheDocument();

    const props = mocks.confirmDialogProps[0];
    expect(props.title).toBe("Archive Website relaunch?");
    expect(props.confirmLabel).toBe("Archive");
    expect(props.variant).toBe("destructive");
  });

  it("archives and refreshes on a successful confirm (AC-11)", async () => {
    mocks.archiveProject.mockResolvedValue({
      ok: true,
      data: { archivedAt: new Date() },
    });
    render(
      <ArchiveProjectButton projectId="p1" projectName="Website relaunch" />,
    );

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await onConfirm();

    expect(mocks.archiveProject).toHaveBeenCalledWith({ id: "p1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
  });

  it("reports the failure message without refreshing when the action fails", async () => {
    mocks.archiveProject.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", message: "" },
    });
    render(
      <ArchiveProjectButton projectId="p1" projectName="Website relaunch" />,
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
