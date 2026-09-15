/**
 * covers: spec 0012 AC-10, AC-11, AC-12, AC-13, AC-17
 *
 * axe over every invoice surface in every state and both themes, plus the
 * few behaviours the pure modules cannot see: which buttons `InvoiceActions`
 * renders per status, that every line row control is named after its line,
 * that the totals block is a live region, and the client page section's
 * count, links and empty states.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceStatus } from "@/db/schema";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import type {
  ClientInvoiceRow,
  InvoiceDetail,
  InvoiceEventRow,
  LineItemRow,
} from "../queries";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  action: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));

vi.mock("../line-items", () => ({
  addLineItem: mocks.action,
  updateLineItem: mocks.action,
  removeLineItem: mocks.action,
  moveLineItem: mocks.action,
}));
vi.mock("../issue-invoice", () => ({ issueInvoice: mocks.action }));
vi.mock("../transition-invoice", () => ({
  markInvoicePaid: mocks.action,
  voidInvoice: mocks.action,
}));
vi.mock("../resend-invoice-notification", () => ({
  resendInvoiceNotification: mocks.action,
}));
vi.mock("../update-invoice-draft", () => ({
  updateInvoiceDraft: mocks.action,
}));
vi.mock("../create-invoice-draft", () => ({
  createInvoiceDraft: mocks.action,
}));

const { InvoiceActions } = await import("./invoice-actions");
const { InvoiceDocument } = await import("./invoice-document");
const { InvoiceEventsList } = await import("./invoice-events-list");
const { InvoiceHeaderForm } = await import("./invoice-header-form");
const { InvoiceTotals, formatTaxRate } = await import("./invoice-totals");
const { InvoicesFilterBar } = await import("./invoices-filter-bar");
const { InvoicesPagination } = await import("./invoices-pagination");
const { InvoicesSection } = await import("./invoices-section");
const { LineItemsEditor } = await import("./line-items-editor");
const { NewInvoiceForm } = await import("./new-invoice-form");
const { NotificationWarning } = await import("./notification-warning");

const NOW = new Date("2026-09-15T10:00:00Z");

const LINES: readonly LineItemRow[] = [
  {
    id: "l1",
    orgId: "org",
    invoiceId: "inv",
    description: "Discovery workshop",
    quantity: "1.000",
    unitAmountCents: 180000,
    amountCents: 180000,
    position: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "l2",
    orgId: "org",
    invoiceId: "inv",
    description: "Design revisions",
    quantity: "3.500",
    unitAmountCents: 12500,
    amountCents: 43750,
    position: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const EVENTS: readonly InvoiceEventRow[] = [
  {
    id: "e2",
    orgId: "org",
    invoiceId: "inv",
    kind: "notification_failed",
    fromStatus: null,
    toStatus: null,
    actorUserId: "u1",
    note: "delivered: a@x.test; failed: b@y.test (mailbox full)",
    createdAt: NOW,
    actorName: "Sarah Chen",
  },
  {
    id: "e1",
    orgId: "org",
    invoiceId: "inv",
    kind: "issued",
    fromStatus: "draft",
    toStatus: "sent",
    actorUserId: null,
    note: null,
    createdAt: NOW,
    actorName: "System",
  },
];

function detail(status: InvoiceStatus): InvoiceDetail {
  return {
    id: "inv",
    orgId: "org",
    clientId: "c1",
    number: status === "draft" ? null : 12,
    status,
    issueDate: status === "draft" ? null : "2026-09-01",
    dueDate: "2026-10-01",
    currency: "USD",
    subtotalCents: 223750,
    taxRateBp: 725,
    taxCents: 16222,
    totalCents: 239972,
    paidAt: status === "paid" ? NOW : null,
    notes: "Net 30.",
    createdAt: NOW,
    updatedAt: NOW,
    client: { id: "c1", name: "Northwind", archivedAt: null },
    lines: LINES,
    events: EVENTS,
  };
}

const CLIENT = { id: "c1", name: "Northwind", archivedAt: null };

const CLIENT_ROWS: readonly ClientInvoiceRow[] = [
  { ...detail("sent"), id: "i1", pastDue: true },
  { ...detail("draft"), id: "i2", pastDue: false },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InvoiceActions", () => {
  it.each([
    ["draft", ["Issue invoice", "Void"]],
    ["sent", ["Mark paid", "Resend notification", "Void"]],
    ["overdue", ["Mark paid", "Resend notification", "Void"]],
  ] as const)("renders exactly the buttons for %s (AC-11)", (status, names) => {
    render(
      <InvoiceActions
        invoiceId="inv"
        status={status}
        issueDate="2026-09-01"
        lineCount={2}
        contactCount={2}
        today="2026-09-15"
      />,
    );

    const group = screen.getByRole("group", { name: "Invoice actions" });
    const buttons = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(buttons).toStrictEqual([...names]);
  });

  it.each(["paid", "void"] as const)(
    "renders nothing for %s (AC-9)",
    (status) => {
      const { container } = render(
        <InvoiceActions
          invoiceId="inv"
          status={status}
          issueDate="2026-09-01"
          lineCount={2}
          contactCount={2}
          today="2026-09-15"
        />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("disables Issue on a draft with no lines (AC-5)", () => {
    render(
      <InvoiceActions
        invoiceId="inv"
        status="draft"
        issueDate={null}
        lineCount={0}
        contactCount={0}
        today="2026-09-15"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Issue invoice" }),
    ).toBeDisabled();
  });
});

describe("LineItemsEditor", () => {
  it("names every row control after its line (AC-17)", () => {
    render(<LineItemsEditor invoiceId="inv" currency="USD" lines={LINES} />);

    for (const line of LINES) {
      for (const verb of ["Move", "Edit", "Remove"]) {
        const pattern = new RegExp(`^${verb} ${line.description}`);
        expect(
          screen.getAllByRole("button", { name: pattern }).length,
        ).toBeGreaterThan(0);
      }
    }

    expect(
      screen.getByRole("button", { name: "Move Discovery workshop up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Design revisions down" }),
    ).toBeDisabled();
  });

  it("shows the empty message and the add form with no lines", () => {
    render(<LineItemsEditor invoiceId="inv" currency="USD" lines={[]} />);

    expect(screen.getByText(/No lines yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add line" })).toBeEnabled();
  });
});

describe("InvoiceTotals", () => {
  it("is a status live region carrying the three figures (AC-4, AC-17)", () => {
    render(
      <InvoiceTotals
        subtotalCents={223750}
        taxRateBp={725}
        taxCents={16222}
        totalCents={239972}
        currency="USD"
      />,
    );

    const region = screen.getByRole("status", { name: "Invoice totals" });
    expect(region).toHaveTextContent("$2,237.50");
    expect(region).toHaveTextContent("Tax (7.25%)");
    expect(region).toHaveTextContent("$2,399.72");
  });

  it.each([
    [0, "0%"],
    [2000, "20%"],
    [725, "7.25%"],
    [720, "7.2%"],
    [10000, "100%"],
  ])("formats %d basis points as %s", (bp, expected) => {
    expect(formatTaxRate(bp)).toBe(expected);
  });
});

describe("InvoicesSection", () => {
  it("counts the rows in the heading and links each one (AC-13)", () => {
    render(<InvoicesSection client={CLIENT} invoices={CLIENT_ROWS} />);

    expect(
      screen.getByRole("heading", { name: /Invoices \(2\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /INV-0012/ })).toHaveAttribute(
      "href",
      "/invoices/i1",
    );
    expect(screen.getByText("Past due")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New invoice/ })).toHaveAttribute(
      "href",
      "/invoices/new?client=c1",
    );
  });

  it("omits the New invoice link for an archived client, and has an empty state", () => {
    render(
      <InvoicesSection client={{ ...CLIENT, archivedAt: NOW }} invoices={[]} />,
    );

    expect(
      screen.queryByRole("link", { name: /New invoice/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No invoices")).toBeInTheDocument();
  });

  it("shows a reload prompt when the read failed", () => {
    render(<InvoicesSection client={CLIENT} invoices={undefined} />);

    expect(
      screen.getByText("Invoices could not be loaded"),
    ).toBeInTheDocument();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation across the draft editor", async () => {
    const { container } = render(
      <>
        <InvoiceActions
          invoiceId="inv"
          status="draft"
          issueDate={null}
          lineCount={2}
          contactCount={0}
          today="2026-09-15"
        />
        <InvoiceHeaderForm
          invoiceId="inv"
          clientId="c1"
          dueDate="2026-10-01"
          taxRateBp={725}
          notes={null}
          currency="USD"
          clientOptions={[{ id: "c1", name: "Northwind" }]}
        />
        <LineItemsEditor invoiceId="inv" currency="USD" lines={LINES} />
        <InvoiceTotals
          subtotalCents={223750}
          taxRateBp={725}
          taxCents={16222}
          totalCents={239972}
          currency="USD"
        />
      </>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation across the frozen document, the warning and the history", async () => {
    const { container } = render(
      <>
        <InvoiceActions
          invoiceId="inv"
          status="overdue"
          issueDate="2026-09-01"
          lineCount={2}
          contactCount={2}
          today="2026-09-15"
        />
        <NotificationWarning
          invoiceId="inv"
          reason="failed: b@y.test (mailbox full)"
          canResend
        />
        <InvoiceDocument invoice={detail("overdue")} />
        <InvoiceEventsList events={EVENTS} />
        <InvoiceEventsList events={[]} />
      </>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation across the list controls, the create form and the client section", async () => {
    const { container } = render(
      <>
        <NewInvoiceForm
          clientOptions={[{ id: "c1", name: "Northwind" }]}
          defaultCurrency="USD"
        />
        <InvoicesFilterBar
          status="sent"
          clientId="c1"
          includeVoid={false}
          clientOptions={[{ id: "c1", name: "Northwind", archived: true }]}
        />
        <InvoicesPagination
          page={2}
          pageCount={9}
          status="sent"
          clientId="c1"
          includeVoid
        />
        <InvoicesSection client={CLIENT} invoices={CLIENT_ROWS} />
        <InvoicesSection client={CLIENT} invoices={[]} />
        <InvoicesSection client={CLIENT} invoices={undefined} />
      </>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
