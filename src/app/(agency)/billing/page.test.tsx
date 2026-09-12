/**
 * covers: spec 0007 AC-1, AC-5, AC-7, AC-13, AC-17, AC-19, spec 0004 AC-22,
 * spec 0008 AC-4, AC-10
 *
 * `subscriptionForAgency`, `agencyAccessFromRow` and `BillingActions` are
 * mocked (each has its own tests); `billingView` and `LockedNotice` are real,
 * so the words on the page are the words the product shows. This file is
 * about what the page reads, who it offers the buttons to, the promise that
 * no Stripe call happens on render, and the notice a locked agency lands on.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionRow } from "@/payments/queries";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  agencyAccessFromRow: vi.fn(),
  subscriptionForAgency: vi.fn(),
  stripeClient: vi.fn(),
  billingActionsProps: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/access/gate", () => ({
  agencyAccessFromRow: mocks.agencyAccessFromRow,
}));
vi.mock("@/payments/queries", () => ({
  subscriptionForAgency: mocks.subscriptionForAgency,
}));
vi.mock("@/payments/stripe", () => ({ stripeClient: mocks.stripeClient }));
vi.mock("@/payments/ui/billing-actions", () => ({
  BillingActions: (props: Record<string, unknown>) => {
    mocks.billingActionsProps.push(props);

    return (
      <div data-testid="billing-actions">
        {props.canSubscribe ? <button type="button">Subscribe</button> : null}
        {props.canOpenPortal ? (
          <button type="button">Manage billing</button>
        ) : null}
      </div>
    );
  },
}));

const { default: BillingPage } = await import("./page");

const ADMIN = {
  kind: "staff" as const,
  orgId: "00000000-0000-7000-8000-000000000002",
  clerkOrgId: "org_clerk",
  userId: "user-1",
  clerkUserId: "user_clerk",
  role: "admin" as const,
};

const MEMBER = { ...ADMIN, role: "member" as const };

function row(patch: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    orgId: ADMIN.orgId,
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    stripePriceId: "price_test",
    status: "active",
    currentPeriodEnd: new Date("2026-10-01T12:00:00Z"),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    ...patch,
  };
}

async function renderPage() {
  return render(await BillingPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.billingActionsProps.length = 0;
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue(ADMIN);
  mocks.agencyAccessFromRow.mockReturnValue({
    level: "unsubscribed",
    role: "admin",
  });
  mocks.subscriptionForAgency.mockResolvedValue(undefined);
});

describe("what the page reads", () => {
  it("reads the one local row for the signed in agency and nothing from Stripe (AC-17)", async () => {
    mocks.subscriptionForAgency.mockResolvedValue(row());

    await renderPage();

    expect(mocks.subscriptionForAgency).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionForAgency).toHaveBeenCalledWith(ADMIN);
    expect(mocks.stripeClient).not.toHaveBeenCalled();
  });

  it("shows the never subscribed state with no session at all when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.subscriptionForAgency).not.toHaveBeenCalled();
    expect(mocks.agencyAccessFromRow).not.toHaveBeenCalled();
    expect(screen.getByText("No subscription")).toBeInTheDocument();
  });
});

describe("the locked notice (spec 0008, AC-4, AC-10)", () => {
  it("renders at every level: the page is outside the gate, so it never redirects", async () => {
    for (const level of ["unsubscribed", "full", "grace", "locked"]) {
      mocks.agencyAccessFromRow.mockReturnValue({ level, role: "admin" });

      const { unmount } = await renderPage();

      expect(
        screen.getByRole("heading", { level: 1, name: "Billing" }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("opens with the notice when the level is locked, and tells an admin what restores access", async () => {
    mocks.agencyAccessFromRow.mockReturnValue({
      level: "locked",
      role: "admin",
    });
    mocks.subscriptionForAgency.mockResolvedValue(row({ status: "unpaid" }));

    await renderPage();

    const notice = screen.getByRole("region", { name: "Access is paused" });
    expect(notice).toHaveTextContent("Nothing has been deleted");
    expect(notice).toHaveTextContent(/Subscribing again, or updating the card/);
  });

  it("tells a member that only an admin can fix it", async () => {
    mocks.agencyContext.mockResolvedValue(MEMBER);
    mocks.agencyAccessFromRow.mockReturnValue({
      level: "locked",
      role: "member",
    });
    mocks.subscriptionForAgency.mockResolvedValue(row({ status: "canceled" }));

    await renderPage();

    expect(
      screen.getByRole("region", { name: "Access is paused" }),
    ).toHaveTextContent(/Only an admin of this agency can subscribe again/);
  });

  it.each(["unsubscribed", "full", "grace"])(
    "shows no notice on %s",
    async (level) => {
      mocks.agencyAccessFromRow.mockReturnValue({ level, role: "admin" });

      await renderPage();

      expect(
        screen.queryByRole("region", { name: "Access is paused" }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("what the page says", () => {
  it("says No subscription and offers Subscribe with no portal link when there is no row (AC-1)", async () => {
    await renderPage();

    expect(screen.getByText("No subscription")).toBeInTheDocument();
    expect(screen.getByText(/14 day free trial/)).toBeInTheDocument();
    expect(mocks.billingActionsProps[0]).toStrictEqual({
      canSubscribe: true,
      canOpenPortal: false,
    });
  });

  it("says Free trial and names the day the trial ends, in UTC and labelled (AC-5)", async () => {
    mocks.subscriptionForAgency.mockResolvedValue(
      row({
        status: "trialing",
        currentPeriodEnd: new Date("2026-09-25T23:30:00Z"),
      }),
    );

    await renderPage();

    expect(screen.getByText("Free trial")).toBeInTheDocument();
    expect(
      screen.getByText("Your free trial ends on 25 September 2026 (UTC)."),
    ).toBeInTheDocument();
  });

  it("says when access ends once a cancellation is scheduled (AC-7)", async () => {
    mocks.subscriptionForAgency.mockResolvedValue(
      row({ status: "active", cancelAtPeriodEnd: true }),
    );

    await renderPage();

    expect(
      screen.getByText("Your access ends on 1 October 2026 (UTC)."),
    ).toBeInTheDocument();
  });

  it("offers both Subscribe and Manage billing once the subscription is cancelled (AC-6, AC-7)", async () => {
    mocks.subscriptionForAgency.mockResolvedValue(
      row({ status: "canceled", currentPeriodEnd: null }),
    );

    await renderPage();

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(mocks.billingActionsProps[0]).toStrictEqual({
      canSubscribe: true,
      canOpenPortal: true,
    });
  });

  it("carries the status in words, so the chip's colour is never the only signal (AC-19)", async () => {
    mocks.subscriptionForAgency.mockResolvedValue(row({ status: "past_due" }));

    await renderPage();

    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(
      screen.getByText(/The last payment did not go through/),
    ).toBeInTheDocument();
  });
});

describe("who gets the buttons (AC-13)", () => {
  it("shows an admin the actions", async () => {
    await renderPage();

    expect(screen.getByTestId("billing-actions")).toBeInTheDocument();
    expect(
      screen.queryByText(/Only an admin of this agency/),
    ).not.toBeInTheDocument();
  });

  it("shows a member the same status, no buttons, and the only an admin sentence", async () => {
    mocks.agencyContext.mockResolvedValue(MEMBER);
    mocks.subscriptionForAgency.mockResolvedValue(row({ status: "trialing" }));

    await renderPage();

    expect(screen.getByText("Free trial")).toBeInTheDocument();
    expect(screen.queryByTestId("billing-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Only an admin of this agency can change the subscription/,
      ),
    ).toBeInTheDocument();
  });

  it("decides from the role on the session context, not from anything on the row", async () => {
    // The row says nothing about roles; only the context does. A member with a
    // live subscription still gets no buttons.
    mocks.agencyContext.mockResolvedValue(MEMBER);
    mocks.subscriptionForAgency.mockResolvedValue(row());

    await renderPage();

    expect(mocks.billingActionsProps).toHaveLength(0);
  });

  it("shows no buttons when there is no session either", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(screen.queryByTestId("billing-actions")).not.toBeInTheDocument();
  });
});

describe("accessibility (AC-19)", () => {
  it("has one page heading and a subscription heading", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Subscription" }),
    ).toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme, never subscribed",
    async (theme) => {
      const { container } = await renderPage();

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );

  it.each(THEMES)(
    "has no axe violation in the %s theme, as a member on a trial",
    async (theme) => {
      mocks.agencyContext.mockResolvedValue(MEMBER);
      mocks.subscriptionForAgency.mockResolvedValue(
        row({ status: "trialing" }),
      );

      const { container } = await renderPage();

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
