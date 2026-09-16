/**
 * covers: spec 0012 AC-2, AC-7, AC-11, AC-12, AC-13, AC-14, spec 0004 AC-22
 *
 * `getInvoice` and `contactsToNotify` are mocked (each has its own tests, as
 * does `latestNotification`, kept real here since it is a pure read of the
 * events this file already controls); every invoice UI section is stubbed to
 * a div recording its props (each has its own render tests). This file is
 * about `InvoiceDetailPage`'s own job: resolving not found the same way for
 * a missing id, another agency's id and no Clerk session at all (AC-14), the
 * draft editor versus the frozen document (AC-2, AC-11), the client options
 * a draft's header form gets including its own client if archived since
 * (AC-2), the past due badge and the paid caption (AC-12), and turning the
 * latest notification attempt into a warning only when it failed (AC-7).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  agencyProfile: vi.fn(),
  getInvoice: vi.fn(),
  contactsToNotify: vi.fn(),
  listClientOptions: vi.fn(),
  InvoiceActions: vi.fn(),
  InvoiceHeaderForm: vi.fn(),
  NotificationWarning: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/db/tenant", () => ({ agencyProfile: mocks.agencyProfile }));
vi.mock("@/clients/queries", () => ({
  listClientOptions: mocks.listClientOptions,
}));
vi.mock("@/invoices/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/invoices/queries")>();
  return {
    ...actual,
    getInvoice: mocks.getInvoice,
    contactsToNotify: mocks.contactsToNotify,
  };
});
vi.mock("@/invoices/ui/invoice-actions", () => ({
  InvoiceActions: (props: Record<string, unknown>) => {
    mocks.InvoiceActions(props);
    return <div data-testid="invoice-actions" />;
  },
}));
vi.mock("@/invoices/ui/invoice-document", () => ({
  InvoiceDocument: () => <div data-testid="invoice-document" />,
}));
vi.mock("@/invoices/ui/invoice-events-list", () => ({
  InvoiceEventsList: () => <div data-testid="invoice-events-list" />,
}));
vi.mock("@/invoices/ui/invoice-header-form", () => ({
  InvoiceHeaderForm: (props: Record<string, unknown>) => {
    mocks.InvoiceHeaderForm(props);
    return <div data-testid="invoice-header-form" />;
  },
}));
vi.mock("@/invoices/ui/invoice-totals", () => ({
  InvoiceTotals: () => <div data-testid="invoice-totals" />,
}));
vi.mock("@/invoices/ui/line-items-editor", () => ({
  LineItemsEditor: () => <div data-testid="line-items-editor" />,
}));
vi.mock("@/invoices/ui/notification-warning", () => ({
  NotificationWarning: (props: Record<string, unknown>) => {
    mocks.NotificationWarning(props);
    return (
      <div data-testid="notification-warning">{props.reason as string}</div>
    );
  },
}));

const { default: InvoiceDetailPage } = await import("./page");

async function renderPage(id = "invoice-1") {
  return render(
    await InvoiceDetailPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    }),
  );
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    status: "draft",
    number: null,
    clientId: "client-1",
    client: { id: "client-1", name: "Northwind Coffee", archivedAt: null },
    issueDate: null,
    dueDate: "2026-10-16",
    currency: "USD",
    subtotalCents: 0,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 0,
    paidAt: null,
    notes: null,
    lines: [],
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.agencyProfile.mockResolvedValue({
    id: "org-1",
    name: "Acme Agency",
    slug: "acme",
    defaultCurrency: "USD",
  });
  mocks.contactsToNotify.mockResolvedValue([]);
  mocks.listClientOptions.mockResolvedValue([
    { id: "client-1", name: "Northwind Coffee" },
  ]);
});

describe("InvoiceDetailPage", () => {
  it("resolves not found for a missing invoice, the same as a foreign agency's id (AC-14)", async () => {
    mocks.getInvoice.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-invoice")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.getInvoice).toHaveBeenCalledWith(
      { orgId: "org-1" },
      "someone-elses-invoice",
    );
  });

  it("resolves not found with no Clerk session, never resolving a query at all (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(renderPage()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.getInvoice).not.toHaveBeenCalled();
  });

  it("shows the header form and line editor, not the frozen document, for a draft (AC-2, AC-11)", async () => {
    mocks.getInvoice.mockResolvedValue(invoice());

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Draft invoice for Northwind Coffee",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invoice-header-form")).toBeInTheDocument();
    expect(screen.getByTestId("line-items-editor")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-totals")).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-document")).not.toBeInTheDocument();
    expect(mocks.listClientOptions).toHaveBeenCalledWith({ orgId: "org-1" });
  });

  it("appends the draft's own client as an archived option when it has since been archived (AC-2)", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        client: {
          id: "client-2",
          name: "Old Harbor",
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
    );
    mocks.listClientOptions.mockResolvedValue([
      { id: "client-1", name: "Northwind Coffee" },
    ]);

    await renderPage();

    const props = mocks.InvoiceHeaderForm.mock.calls.at(-1)?.[0];
    expect(props.clientOptions).toContainEqual({
      id: "client-2",
      name: "Old Harbor (archived)",
    });
  });

  it("shows the frozen document, not the editor, once issued (AC-2, AC-11)", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "sent",
        number: 1,
        issueDate: "2026-09-01",
        totalCents: 15000,
      }),
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "INV-0001" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invoice-document")).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-header-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-items-editor")).not.toBeInTheDocument();
    expect(mocks.listClientOptions).not.toHaveBeenCalled();
  });

  it("titles a voided draft distinctly from a numbered invoice", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({ status: "void", number: null }),
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Voided draft" }),
    ).toBeInTheDocument();
  });

  it("shows the past due badge on a sent invoice overdue its due date, not on one still current (AC-12)", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "sent",
        number: 1,
        issueDate: "2026-08-01",
        dueDate: "2020-01-01",
      }),
    );

    await renderPage();

    expect(screen.getByText("Past due")).toBeInTheDocument();
  });

  it("shows no past due badge for a sent invoice not yet due", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "sent",
        number: 1,
        issueDate: "2026-08-01",
        dueDate: "2099-01-01",
      }),
    );

    await renderPage();

    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
  });

  it("shows the paid date caption for a paid invoice", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "paid",
        number: 1,
        issueDate: "2026-08-01",
        paidAt: new Date("2026-08-15T00:00:00.000Z"),
      }),
    );

    await renderPage();

    expect(screen.getByText("Paid on 2026-08-15")).toBeInTheDocument();
  });

  it("passes the resolved contact count to InvoiceActions (AC-6)", async () => {
    mocks.getInvoice.mockResolvedValue(invoice());
    mocks.contactsToNotify.mockResolvedValue([
      { id: "c1", name: "Priya", email: "priya@northwind.test" },
      { id: "c2", name: "Devon", email: "devon@northwind.test" },
    ]);

    await renderPage();

    expect(mocks.InvoiceActions).toHaveBeenCalledWith(
      expect.objectContaining({ contactCount: 2 }),
    );
  });

  it("shows the notification warning when the latest attempt failed, with its reason (AC-7)", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "sent",
        number: 1,
        issueDate: "2026-08-01",
        events: [
          {
            id: "e2",
            kind: "notification_failed",
            note: "no contacts to notify",
            createdAt: new Date("2026-08-01T00:01:00.000Z"),
            actorName: "System",
          },
          {
            id: "e1",
            kind: "issued",
            note: null,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            actorName: "Staff A",
          },
        ],
      }),
    );

    await renderPage();

    expect(screen.getByTestId("notification-warning")).toHaveTextContent(
      "no contacts to notify",
    );
    expect(mocks.NotificationWarning).toHaveBeenCalledWith(
      expect.objectContaining({ canResend: true }),
    );
  });

  it("does not offer resend from the warning on a voided invoice, where no action is left", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "void",
        number: 1,
        events: [
          {
            id: "e1",
            kind: "notification_failed",
            note: "mailbox full",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            actorName: "System",
          },
        ],
      }),
    );

    await renderPage();

    expect(mocks.NotificationWarning).toHaveBeenCalledWith(
      expect.objectContaining({ canResend: false }),
    );
  });

  it("shows no warning when the latest notification succeeded", async () => {
    mocks.getInvoice.mockResolvedValue(
      invoice({
        status: "sent",
        number: 1,
        events: [
          {
            id: "e1",
            kind: "notified",
            note: null,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            actorName: "System",
          },
        ],
      }),
    );

    await renderPage();

    expect(
      screen.queryByTestId("notification-warning"),
    ).not.toBeInTheDocument();
  });
});
