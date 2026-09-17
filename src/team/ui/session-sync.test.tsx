/**
 * covers: spec 0015 AC-7
 *
 * `useSessionSync` reads `undefined` with no provider, exactly what a
 * control needs to skip the step in the `/design` gallery. Inside
 * `ClerkSessionSync`, `leftAgency` clears the active organization and
 * `roleChanged` reactivates the given one, both through Clerk's own
 * `setActive`, which is what reissues the session token.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useSessionSync } from "./session-sync";

const mocks = vi.hoisted(() => ({ setActive: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ setActive: mocks.setActive }),
}));

const { ClerkSessionSync } = await import("./session-sync");

function ReadsSync() {
  const session = useSessionSync();

  return <span>{session ? "provided" : "undefined"}</span>;
}

/** Exercises both callbacks through real clicks, not a captured reference. */
function SyncButtons() {
  const session = useSessionSync();

  return (
    <>
      <button onClick={() => void session?.leftAgency()}>Leave</button>
      <button onClick={() => void session?.roleChanged("org_northwind")}>
        Change role
      </button>
    </>
  );
}

describe("useSessionSync with no provider", () => {
  it("is undefined, so a control can skip the step (as the /design gallery does)", () => {
    render(<ReadsSync />);

    expect(screen.getByText("undefined")).toBeInTheDocument();
  });
});

describe("ClerkSessionSync", () => {
  it("provides a session sync to its children", () => {
    render(
      <ClerkSessionSync>
        <ReadsSync />
      </ClerkSessionSync>,
    );

    expect(screen.getByText("provided")).toBeInTheDocument();
  });

  it("leftAgency clears the active organization through Clerk", async () => {
    const user = userEvent.setup();

    render(
      <ClerkSessionSync>
        <SyncButtons />
      </ClerkSessionSync>,
    );
    await user.click(screen.getByRole("button", { name: "Leave" }));

    expect(mocks.setActive).toHaveBeenCalledWith({ organization: null });
  });

  it("roleChanged reactivates the given organization through Clerk", async () => {
    const user = userEvent.setup();

    render(
      <ClerkSessionSync>
        <SyncButtons />
      </ClerkSessionSync>,
    );
    await user.click(screen.getByRole("button", { name: "Change role" }));

    expect(mocks.setActive).toHaveBeenCalledWith({
      organization: "org_northwind",
    });
  });
});
