/**
 * covers: spec 0015 AC-2, AC-3
 *
 * `inviteTeamMember` is mocked (it has its own tests in `../actions.test.ts`
 * and `../clerk-wrappers.test.ts`); this file is about the form's own job: it
 * sends the typed email with the selected role, a duplicate address renders
 * as a field error beside the email rather than a general alert, any other
 * failure renders as a general alert and keeps what was typed, and success
 * clears the address, keeps the role, and announces who was invited.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom implements neither pointer capture nor ResizeObserver, and Radix
// Select's trigger checks pointer capture on open (see primitives.test.tsx).
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof window.HTMLElement.prototype.hasPointerCapture === "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}
if (typeof window.HTMLElement.prototype.scrollIntoView === "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const mocks = vi.hoisted(() => ({
  inviteTeamMember: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/team/invite-team-member", () => ({
  inviteTeamMember: mocks.inviteTeamMember,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { InviteForm } = await import("./invite-form");

beforeEach(() => {
  vi.clearAllMocks();
});

async function selectRole(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("InviteForm (AC-2)", () => {
  it("defaults the role to member and renders an empty address", () => {
    render(<InviteForm agencyName="Northwind Studio" />);

    expect(screen.getByRole("textbox", { name: /email/i })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(
      "Member",
    );
  });

  it("sends the typed email with the selected role, announces success, clears the address, and keeps the role", async () => {
    mocks.inviteTeamMember.mockResolvedValue({
      ok: true,
      data: { invitationId: "orginv_new" },
    });
    const user = userEvent.setup();

    render(<InviteForm agencyName="Northwind Studio" />);
    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      "sam@northwind.example",
    );
    await selectRole(user, "Admin");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(mocks.inviteTeamMember).toHaveBeenCalledWith({
      email: "sam@northwind.example",
      role: "admin",
    });
    expect(
      await screen.findByText("Invitation sent to sam@northwind.example."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email/i })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(
      "Admin",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a duplicate address as a field error beside the email, not a general alert (AC-3)", async () => {
    mocks.inviteTeamMember.mockResolvedValue({
      ok: false,
      error: {
        code: "conflict",
        message: "They are already a member.",
        fieldErrors: { email: ["They are already a member."] },
      },
    });
    const user = userEvent.setup();

    render(<InviteForm agencyName="Northwind Studio" />);
    const email = screen.getByRole("textbox", { name: /email/i });
    await user.type(email, "grace@northwind.example");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(
      await screen.findByText("They are already a member."),
    ).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveValue("grace@northwind.example");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows any other failure as a general alert and keeps what was typed (AC-11)", async () => {
    mocks.inviteTeamMember.mockResolvedValue({
      ok: false,
      error: {
        code: "unavailable",
        message: "The team service could not be reached. Nothing was changed.",
      },
    });
    const user = userEvent.setup();

    render(<InviteForm agencyName="Northwind Studio" />);
    const email = screen.getByRole("textbox", { name: /email/i });
    await user.type(email, "sam@northwind.example");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The team service could not be reached. Nothing was changed.",
    );
    expect(email).toHaveValue("sam@northwind.example");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
