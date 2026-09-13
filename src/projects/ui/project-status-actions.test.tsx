/**
 * covers: spec 0010 AC-8, AC-9, AC-10
 *
 * `nextStatuses` (its own tests already cover the workflow rule) is what
 * decides which buttons show; this file is about `ProjectStatusActions`
 * rendering exactly those, submitting the right move, and refreshing on
 * every result -- success or the stale-button conflict alike -- so a stale
 * set of buttons never lingers.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transitionProject: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../transition-project", () => ({
  transitionProject: mocks.transitionProject,
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

const { ProjectStatusActions } = await import("./project-status-actions");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("ProjectStatusActions", () => {
  it("shows exactly Start work for planning (AC-8)", () => {
    render(
      <ProjectStatusActions
        projectId="p1"
        status="planning"
        archived={false}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Move this project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start work" }),
    ).toBeInTheDocument();
  });

  it("shows exactly Send to review and Reopen for in_review, in that presence (AC-8)", () => {
    render(
      <ProjectStatusActions
        projectId="p1"
        status="in_review"
        archived={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Mark delivered" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("renders nothing for delivered (AC-8)", () => {
    const { container } = render(
      <ProjectStatusActions
        projectId="p1"
        status="delivered"
        archived={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while archived, whatever the status (AC-10)", () => {
    const { container } = render(
      <ProjectStatusActions projectId="p1" status="in_review" archived />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("submits a plain move with the current status as from, and refreshes on success", async () => {
    const user = userEvent.setup();
    mocks.transitionProject.mockResolvedValue({
      ok: true,
      data: { status: "in_progress" },
    });

    render(
      <ProjectStatusActions
        projectId="p1"
        status="planning"
        archived={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start work" }));

    expect(mocks.transitionProject).toHaveBeenCalledWith({
      id: "p1",
      from: "planning",
      to: "in_progress",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the conflict inline and still refreshes, so stale buttons never linger (AC-9)", async () => {
    const user = userEvent.setup();
    mocks.transitionProject.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });

    render(
      <ProjectStatusActions
        projectId="p1"
        status="planning"
        archived={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start work" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone changed this while you were working. Reload and try again.",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("confirms before marking delivered, and refreshes on both outcomes", async () => {
    mocks.transitionProject.mockResolvedValue({
      ok: true,
      data: { status: "delivered" },
    });

    render(
      <ProjectStatusActions
        projectId="p1"
        status="in_review"
        archived={false}
      />,
    );

    const props = mocks.confirmDialogProps[0];
    expect(props.title).toBe("Mark this project as delivered?");

    const onConfirm = props.onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await onConfirm();

    expect(mocks.transitionProject).toHaveBeenCalledWith({
      id: "p1",
      from: "in_review",
      to: "delivered",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
  });
});
