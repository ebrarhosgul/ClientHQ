/**
 * @vitest-environment node
 *
 * covers: spec 0020 AC-1, AC-2, AC-9, AC-11, AC-13
 *
 * The page is a tree of async Server Components (the header, then three
 * independent `<Suspense>` sections), so it is rendered with React's own
 * streaming renderer rather than Testing Library's `render()`, and awaited to
 * `allReady` so every boundary has settled before assertions run. The
 * `src/dashboard/queries` reads are stubbed; each section's own behavior
 * (empty, error) is exercised in this suite, not the query implementations
 * (covered by `src/dashboard/queries.test.ts` and `queries.db.test.ts`).
 */
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  currentAgency: vi.fn(),
  hasAnyClient: vi.fn(),
  overdueInvoicesSummary: vi.fn(),
  openProjectsSummary: vi.fn(),
  recentDeliverablesSummary: vi.fn(),
  reportException: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/auth/context", () => ({
  agencyContext: mocks.agencyContext,
  currentAgency: mocks.currentAgency,
}));

vi.mock("@/dashboard/queries", () => ({
  hasAnyClient: mocks.hasAnyClient,
  overdueInvoicesSummary: mocks.overdueInvoicesSummary,
  openProjectsSummary: mocks.openProjectsSummary,
  recentDeliverablesSummary: mocks.recentDeliverablesSummary,
}));

vi.mock("@/observability/sentry", () => ({
  reportException: mocks.reportException,
}));

const { default: DashboardPage } = await import("./page");

const EMPTY_OVERDUE = { count: 0, totals: [], rows: [] };
const EMPTY_PROJECTS = { count: 0, rows: [] };
const EMPTY_DELIVERABLES = { addedLast7Days: 0, rows: [] };

async function renderPage(): Promise<string> {
  const stream = await renderToReadableStream(await DashboardPage());
  await stream.allReady;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }

  return html;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ role: "admin", orgId: "org-1" });
  mocks.currentAgency.mockResolvedValue({
    name: "Northwind",
    defaultCurrency: "USD",
  });
  mocks.hasAnyClient.mockResolvedValue(true);
  mocks.overdueInvoicesSummary.mockResolvedValue(EMPTY_OVERDUE);
  mocks.openProjectsSummary.mockResolvedValue(EMPTY_PROJECTS);
  mocks.recentDeliverablesSummary.mockResolvedValue(EMPTY_DELIVERABLES);
});

describe("DashboardPage", () => {
  it("names the agency and the acting role in the header (AC-1)", async () => {
    const html = await renderPage();

    expect(html).toContain("Northwind · Admin");
    expect(html).toMatch(/<h1[^>]*>Dashboard<\/h1>/);
  });

  it("spells out the member role too (AC-1)", async () => {
    mocks.agencyContext.mockResolvedValue({ role: "member", orgId: "org-1" });

    const html = await renderPage();

    expect(html).toContain("Northwind · Member");
  });

  it("renders with no session at all when Clerk has no credentials (AC-13)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    const html = await renderPage();

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.hasAnyClient).not.toHaveBeenCalled();
    expect(html).toContain("Add your first client");
  });

  it("shows the first run state and nothing else when the agency has no client (AC-9)", async () => {
    mocks.hasAnyClient.mockResolvedValue(false);

    const html = await renderPage();

    expect(html).toContain("Add your first client");
    expect(mocks.overdueInvoicesSummary).not.toHaveBeenCalled();
    expect(html).not.toContain("Overdue invoices");
  });

  it("streams all three sections once the agency has a client (AC-2)", async () => {
    const html = await renderPage();

    expect(html).toContain("Overdue invoices");
    expect(html).toContain("Open projects");
    expect(html).toContain("Recent deliverables");
    expect(html).toContain("Nothing overdue");
    expect(html).toContain("No open projects");
    expect(html).toContain("No deliverables yet");
  });

  it("isolates a failing section: the other two still render (AC-11)", async () => {
    mocks.overdueInvoicesSummary.mockRejectedValue(new Error("db exploded"));

    const html = await renderPage();

    expect(html).toContain("Overdue invoices could not be loaded");
    expect(html).toContain("No open projects");
    expect(html).toContain("No deliverables yet");
    expect(mocks.reportException).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      expect.objectContaining({ tags: { section: "overdue_invoices" } }),
    );
  });
});
