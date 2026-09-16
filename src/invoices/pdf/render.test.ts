/**
 * @vitest-environment node
 *
 * covers: spec 0013 AC-5, AC-8, AC-9
 *
 * `renderInvoicePdf` against the real `@react-pdf/renderer` and the real
 * embedded fonts, read back with `pdf-parse` rather than trusted blind: a
 * valid PDF, the fonts and hyphenation rule holding on a maximal invoice, and
 * the document metadata.
 */
import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";

import {
  presentInvoice,
  type InvoicePresentation,
} from "@/invoices/presentation";

import { renderInvoicePdf } from "./render";

const CLIENT = {
  name: "Northwind",
  billingAddressLine1: "1 Market St",
  billingAddressLine2: null,
  billingCity: "San Francisco",
  billingRegion: "CA",
  billingPostalCode: "94105",
  billingCountry: "US",
};

function minimalPresentation(): InvoicePresentation {
  return presentInvoice({
    invoice: {
      number: 1,
      status: "sent",
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      currency: "USD",
      taxRateBp: 725,
      subtotalCents: 180000,
      taxCents: 13050,
      totalCents: 193050,
      notes: "Net 30.",
      paidAt: null,
    },
    client: CLIENT,
    lines: [
      {
        id: "l1",
        description: "Discovery workshop",
        quantity: "1.000",
        unitAmountCents: 180000,
        amountCents: 180000,
      },
    ],
    agencyName: "Acme Agency",
    todayUtc: "2026-09-15",
    generatedAt: new Date("2026-09-15T10:30:00Z"),
  });
}

describe("renderInvoicePdf", () => {
  it("renders a valid PDF starting with the PDF signature (AC-8)", async () => {
    const pdf = await renderInvoicePdf(minimalPresentation());

    expect(Buffer.from(pdf).toString("latin1", 0, 5)).toBe("%PDF-");
  });

  it("carries the document metadata: title, author and language (AC-9)", async () => {
    const pdf = await renderInvoicePdf(minimalPresentation());
    const parser = new PDFParse({ data: Buffer.from(pdf) });
    const info = await parser.getInfo();
    await parser.destroy();

    expect(info.info?.Title).toBe("Invoice INV-0001 from Acme Agency");
    expect(info.info?.Author).toBe("Acme Agency");
    // pdf-parse does not surface the catalog's /Lang entry; the renderer
    // writes it straight into the PDF object stream (AC-9).
    expect(Buffer.from(pdf).toString("latin1")).toContain("/Lang (en)");
  });

  it("spans several pages for the maximum line count, repeating the header row and the Turkish letters (AC-5, AC-8)", async () => {
    const lines = Array.from({ length: 100 }, (_, index) => ({
      id: `l${index}`,
      description: `Line ${index + 1}`,
      quantity: "1.000",
      unitAmountCents: 1000,
      amountCents: 1000,
    }));

    const presentation = presentInvoice({
      invoice: {
        number: 2,
        status: "sent",
        issueDate: "2026-09-01",
        dueDate: "2026-10-01",
        currency: "USD",
        taxRateBp: 725,
        subtotalCents: 100000,
        taxCents: 7250,
        totalCents: 107250,
        notes: "Şirket iletişim bilgileri: ş, ğ, İ, ı, ö, ü.\n".repeat(120),
        paidAt: null,
      },
      client: CLIENT,
      lines,
      agencyName: "Şirket Ölçüm",
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T10:30:00Z"),
    });

    const pdf = await renderInvoicePdf(presentation);
    const parser = new PDFParse({ data: Buffer.from(pdf) });
    const result = await parser.getText();
    await parser.destroy();

    expect(result.total).toBeGreaterThan(1);

    for (let page = 1; page <= result.total; page += 1) {
      expect(result.getPageText(page)).toContain("Description");
    }

    expect(result.text).toContain("Şirket Ölçüm");
    expect(result.text).toContain("ş, ğ, İ, ı, ö, ü");
  });
});
