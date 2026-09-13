/**
 * covers: spec 0010 AC-8, AC-9, AC-10
 *
 * `nextStatuses` (its own tests already cover the workflow rule) is what
 * decides which buttons show; this file is about `ProjectStatusActions`
 * rendering exactly those, submitting the right move, and refreshing on
 * every result -- success or the stale-button conflict alike -- so a stale
 * set of buttons never lingers. `router.refresh` is a mock, so what the
 * refresh does to the page is played back here as a rerender with the
 * status it would bring: the conflict sentence has to outlive that.
 */
import { act, render, screen } from "@testing-library/react";
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

  it("keeps the conflict message on screen once the refresh has swapped the buttons for the fresh set (AC-9)", async () => {
    const user = userEvent.setup();
    mocks.transitionProject.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "This project was already moved to In progress.",
      },
    });

    const { rerender } = render(
      <ProjectStatusActions
        projectId="p1"
        status="planning"
        archived={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start work" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // What `router.refresh()` does to this component: the same instance, the
    // status someone else moved it to.
    rerender(
      <ProjectStatusActions
        projectId="p1"
        status="in_progress"
        archived={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Start work" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send to review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project was already moved to In progress.",
    );
  });

  it("keeps the conflict message when the refresh brings back an archived project with no buttons at all (AC-9, AC-10)", async () => {
    const user = userEvent.setup();
    mocks.transitionProject.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "This project is archived." },
    });

    const { rerender } = render(
      <ProjectStatusActions
        projectId="p1"
        status="planning"
        archived={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start work" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    rerender(
      <ProjectStatusActions projectId="p1" status="planning" archived />,
    );

    expect(
      screen.queryByRole("group", { name: "Move this project" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project is archived.",
    );
  });

  it("clears the last error once a later move succeeds", async () => {
    const user = userEvent.setup();
    mocks.transitionProject.mockResolvedValueOnce({
      ok: false,
      error: { code: "conflict", message: "" },
    });
    mocks.transitionProject.mockResolvedValueOnce({
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
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start work" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
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
    const result = await act(() => onConfirm());

    expect(mocks.transitionProject).toHaveBeenCalledWith({
      id: "p1",
      from: "in_review",
      to: "delivered",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ ok: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the delivered dialog on a conflict and shows the message beside the buttons, where the refresh cannot remove it (AC-9)", async () => {
    mocks.transitionProject.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "This project was already moved to In progress.",
      },
    });

    const { rerender } = render(
      <ProjectStatusActions
        projectId="p1"
        status="in_review"
        archived={false}
      />,
    );

    const onConfirm = mocks.confirmDialogProps[0].onConfirm as () => Promise<{
      readonly ok: boolean;
    }>;
    const result = await act(() => onConfirm());

    // `ok: true` is what closes the dialog; the failure is reported outside it.
    expect(result).toStrictEqual({ ok: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project was already moved to In progress.",
    );

    rerender(
      <ProjectStatusActions
        projectId="p1"
        status="in_progress"
        archived={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Mark delivered" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project was already moved to In progress.",
    );
  });
});
