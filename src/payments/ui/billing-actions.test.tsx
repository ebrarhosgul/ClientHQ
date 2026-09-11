/**
 * covers: spec 0007 AC-1, AC-6, AC-13, AC-19
 *
 * The two buttons on `/billing`. Both Server Actions are mocked (each has its
 * own tests); this file is about which buttons appear for which state, that a
 * click reaches the right action, that a refusal comes back as an alert beside
 * the buttons rather than a thrown page, and that the pending state is spoken
 * rather than spun.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));

vi.mock("@/payments/start-checkout", () => ({
  startCheckout: mocks.startCheckout,
}));
vi.mock("@/payments/open-billing-portal", () => ({
  openBillingPortal: mocks.openBillingPortal,
}));

const { BillingActions, OpenBillingPortalButton } =
  await import("./billing-actions");

const FORBIDDEN = {
  ok: false,
  error: {
    code: "forbidden",
    message: "You do not have permission to do that.",
  },
} as const;

const UNAVAILABLE = {
  ok: false,
  error: {
    code: "unavailable",
    message:
      "Billing is not responding right now. Nothing was charged. Try again in a moment.",
  },
} as const;

/** A promise the test resolves by hand, to hold a form in its pending state. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A success never returns in the real thing (the browser is on its way to
  // Stripe); a resolved `ok` is the closest a test can come to that.
  mocks.startCheckout.mockResolvedValue({ ok: true, data: undefined });
  mocks.openBillingPortal.mockResolvedValue({ ok: true, data: undefined });
});

describe("which buttons are offered", () => {
  it("offers Subscribe alone to an agency that has never subscribed (AC-1)", () => {
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    expect(
      screen.getByRole("button", { name: "Subscribe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage billing" }),
    ).not.toBeInTheDocument();
  });

  it("offers Manage billing alone while a subscription is live", () => {
    render(<BillingActions canSubscribe={false} canOpenPortal />);

    expect(
      screen.getByRole("button", { name: "Manage billing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Subscribe" }),
    ).not.toBeInTheDocument();
  });

  it("offers both to an agency that cancelled, so it can come back and read its invoices (AC-6)", () => {
    render(<BillingActions canSubscribe canOpenPortal />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Subscribe" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage billing" }),
    ).toBeInTheDocument();
  });

  it("says where the card details go, which is not here", () => {
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    expect(
      screen.getByText(/Your card details never reach this app/),
    ).toBeInTheDocument();
  });
});

describe("what a click does", () => {
  it("sends Subscribe to startCheckout and nothing else", async () => {
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(mocks.startCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.openBillingPortal).not.toHaveBeenCalled();
  });

  it("sends Manage billing to openBillingPortal and nothing else", async () => {
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal />);

    await user.click(screen.getByRole("button", { name: "Manage billing" }));

    expect(mocks.openBillingPortal).toHaveBeenCalledTimes(1);
    expect(mocks.startCheckout).not.toHaveBeenCalled();
  });

  it("shows no alert after a success, because the browser is already leaving", async () => {
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("when the action refuses", () => {
  it("shows the refusal in an alert beside the buttons rather than throwing the page away (AC-13)", async () => {
    mocks.startCheckout.mockResolvedValue(FORBIDDEN);
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That did not work");
    expect(alert).toHaveTextContent("You do not have permission to do that.");
    expect(
      screen.getByRole("button", { name: "Subscribe" }),
    ).toBeInTheDocument();
  });

  it("shows the portal's refusal the same way", async () => {
    mocks.openBillingPortal.mockResolvedValue(UNAVAILABLE);
    const user = userEvent.setup();
    render(<BillingActions canSubscribe={false} canOpenPortal />);

    await user.click(screen.getByRole("button", { name: "Manage billing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was charged",
    );
  });

  it("keeps the button usable after a refusal, so the agency can try again", async () => {
    mocks.startCheckout.mockResolvedValue(UNAVAILABLE);
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled();
  });
});

describe("while Stripe is being opened (AC-19)", () => {
  it("announces the wait through aria-busy and a label, not a spinner alone", async () => {
    const pending = deferred<typeof FORBIDDEN>();
    mocks.startCheckout.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    const busy = await screen.findByRole("button", { name: "Opening Stripe…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toBeDisabled();

    pending.resolve(FORBIDDEN);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled();
  });

  it("disables the button while pending, so a double click cannot fire twice from here", async () => {
    const pending = deferred<typeof FORBIDDEN>();
    mocks.startCheckout.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal={false} />);

    const button = screen.getByRole("button", { name: "Subscribe" });
    await user.click(button);
    await screen.findByRole("button", { name: "Opening Stripe…" });
    await user.click(screen.getByRole("button", { name: "Opening Stripe…" }));

    expect(mocks.startCheckout).toHaveBeenCalledTimes(1);

    pending.resolve(FORBIDDEN);
    await screen.findByRole("alert");
  });
});

describe("accessibility (AC-19)", () => {
  it("every button is reachable by Tab, in reading order", async () => {
    const user = userEvent.setup();
    render(<BillingActions canSubscribe canOpenPortal />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Subscribe" })).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Manage billing" }),
    ).toHaveFocus();
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme, idle",
    async (theme) => {
      const { container } = render(
        <BillingActions canSubscribe canOpenPortal />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );

  it.each(THEMES)(
    "has no axe violation in the %s theme, with a refusal showing",
    async (theme) => {
      mocks.startCheckout.mockResolvedValue(FORBIDDEN);
      const user = userEvent.setup();
      const { container } = render(
        <BillingActions canSubscribe canOpenPortal={false} />,
      );

      await user.click(screen.getByRole("button", { name: "Subscribe" }));
      await screen.findByRole("alert");

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});

describe("OpenBillingPortalButton on its own (spec 0008, AC-5)", () => {
  it("opens the portal under the caller's label", async () => {
    const user = userEvent.setup();
    render(<OpenBillingPortalButton>Update your card</OpenBillingPortalButton>);

    await user.click(screen.getByRole("button", { name: "Update your card" }));

    expect(mocks.openBillingPortal).toHaveBeenCalledTimes(1);
    expect(mocks.startCheckout).not.toHaveBeenCalled();
  });

  it("defaults to Manage billing", () => {
    render(<OpenBillingPortalButton />);

    expect(
      screen.getByRole("button", { name: "Manage billing" }),
    ).toBeInTheDocument();
  });

  it("shows a refusal as an alert beside itself, not a thrown page", async () => {
    const user = userEvent.setup();
    mocks.openBillingPortal.mockResolvedValue(FORBIDDEN);
    render(<OpenBillingPortalButton />);

    await user.click(screen.getByRole("button", { name: "Manage billing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      FORBIDDEN.error.message,
    );
  });

  it("speaks its pending state", async () => {
    const user = userEvent.setup();
    const pending = deferred<typeof UNAVAILABLE>();
    mocks.openBillingPortal.mockReturnValue(pending.promise);
    render(<OpenBillingPortalButton />);

    await user.click(screen.getByRole("button", { name: "Manage billing" }));

    const busy = await screen.findByRole("button", { name: "Opening Stripe…" });
    expect(busy).toHaveAttribute("aria-busy", "true");

    pending.resolve(UNAVAILABLE);
    await screen.findByRole("alert");
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = render(<OpenBillingPortalButton />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
