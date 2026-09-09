/**
 * covers: spec 0005 AC-6, AC-9
 *
 * Making one agency the active organization. The one thing worth pinning here
 * is the order: `setActive()` is awaited before the redirect, because
 * navigating first would arrive at `/dashboard` with no organization claim yet
 * and bounce straight back to `/onboarding` (AC-9). `@clerk/nextjs` and
 * `next/navigation` are both mocked, since the effect under test is what this
 * hook does with them, not what either provider does internally.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setActive: {
    current: undefined as
      ((args: { organization: string }) => Promise<void>) | undefined,
  },
  replace: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganizationList: () => ({ setActive: mocks.setActive.current }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

const { useActivateAgency } = await import("./use-activate-agency");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.setActive.current = vi.fn(async (args: { organization: string }) => {
    mocks.calls.push(`setActive:${args.organization}`);
  });
  mocks.replace.mockImplementation((path: string) => {
    mocks.calls.push(`replace:${path}`);
  });
});

describe("useActivateAgency", () => {
  it("is not ready while Clerk has not loaded setActive, and activate is a no-op", async () => {
    mocks.setActive.current = undefined;

    const { result } = renderHook(() => useActivateAgency());

    expect(result.current.ready).toBe(false);

    await act(async () => {
      await result.current.activate("org_1");
    });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("awaits setActive before navigating, in that order (AC-9)", async () => {
    const { result } = renderHook(() => useActivateAgency());

    expect(result.current.ready).toBe(true);

    await act(async () => {
      await result.current.activate("org_1");
    });

    expect(mocks.calls).toEqual(["setActive:org_1", "replace:/dashboard"]);
  });

  it("moves to working while the call is in flight, and does not navigate early", async () => {
    let resolveActivation: () => void = () => {};
    mocks.setActive.current = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveActivation = resolve;
        }),
    );

    const { result } = renderHook(() => useActivateAgency());

    act(() => {
      void result.current.activate("org_1");
    });

    await waitFor(() => expect(result.current.state).toBe("working"));
    expect(mocks.replace).not.toHaveBeenCalled();

    await act(async () => {
      resolveActivation();
      await Promise.resolve();
    });

    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("moves to failed when setActive rejects, and never navigates (AC-6)", async () => {
    mocks.setActive.current = vi.fn(async () => {
      throw new Error("clerk is down");
    });

    const { result } = renderHook(() => useActivateAgency());

    await act(async () => {
      await result.current.activate("org_1");
    });

    expect(result.current.state).toBe("failed");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
