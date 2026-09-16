/**
 * The invoice PDF's layout (spec 0013, AC-3, AC-5, AC-9): one `Document`, one
 * `Page`, every string read from an `InvoicePresentation`. This is its own
 * React tree, not the screen's: `invoice-document.tsx` shares values with it
 * through `presentInvoice`, never markup.
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoicePresentation } from "@/invoices/presentation";

import { INVOICE_FONT_FAMILY, registerInvoiceFonts } from "./fonts";

/** A4 in points, with a 40 point margin on every side (AC-5). */
const PAGE_MARGIN = 40;

const styles = StyleSheet.create({
  page: {
    padding: PAGE_MARGIN,
    fontFamily: INVOICE_FONT_FAMILY,
    fontSize: 10,
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  agencyName: { fontSize: 16, fontWeight: 600 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 16, fontWeight: 600 },
  statusLine: { marginTop: 2, color: "#4a4a4a" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  detailColumn: { flexDirection: "column", gap: 2 },
  label: { fontSize: 8, color: "#6b6b6b", marginBottom: 2 },
  value: { fontSize: 10 },
  billToName: { fontSize: 10, fontWeight: 600 },
  table: { marginBottom: 16 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottom: "1pt solid #d0d0d0",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottom: "0.5pt solid #ececec",
  },
  colDescription: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  colQty: { width: 60, textAlign: "right" },
  colUnit: { width: 80, textAlign: "right" },
  colAmount: { width: 80, textAlign: "right" },
  tableHeaderText: { fontSize: 8, fontWeight: 600, color: "#6b6b6b" },
  totals: {
    alignSelf: "flex-end",
    width: 220,
    marginBottom: 16,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalsRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    borderTop: "1pt solid #1a1a1a",
    fontWeight: 600,
  },
  totalsLabel: { color: "#4a4a4a" },
  notes: { marginBottom: 16 },
  notesLabel: { fontSize: 8, color: "#6b6b6b", marginBottom: 4 },
  notesText: { fontSize: 10 },
  footer: {
    position: "absolute",
    bottom: PAGE_MARGIN / 2,
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#8a8a8a",
  },
});

function statusText(status: InvoicePresentation["status"]): string {
  return [status.label, status.pastDue ? "Past due" : undefined, status.paidOn]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

export function InvoicePdf({
  presentation,
}: {
  readonly presentation: InvoicePresentation;
}) {
  registerInvoiceFonts();

  return (
    <Document
      title={presentation.documentTitle}
      author={presentation.agencyName}
      language="en"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.agencyName}>{presentation.agencyName}</Text>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>
              {presentation.title} {presentation.number}
            </Text>
            <Text style={styles.statusLine}>
              {statusText(presentation.status)}
            </Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <View style={styles.detailColumn}>
            <Text style={styles.label}>Bill to</Text>
            <Text style={styles.billToName}>{presentation.billTo.name}</Text>
            {presentation.billTo.lines.map((line) => (
              <Text key={line} style={styles.value}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.detailColumn}>
            <Text style={styles.label}>Issued</Text>
            <Text style={styles.value}>{presentation.issued}</Text>
          </View>
          <View style={styles.detailColumn}>
            <Text style={styles.label}>Due</Text>
            <Text style={styles.value}>{presentation.due}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow} fixed>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>
              Description
            </Text>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colUnit, styles.tableHeaderText]}>Unit</Text>
            <Text style={[styles.colAmount, styles.tableHeaderText]}>
              Amount
            </Text>
          </View>
          {presentation.lines.map((line) => (
            <View key={line.id} style={styles.tableRow} wrap={false}>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnit}>{line.unit}</Text>
              <Text style={styles.colAmount}>{line.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{presentation.totals.subtotal}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              {presentation.totals.taxLabel}
            </Text>
            <Text>{presentation.totals.tax}</Text>
          </View>
          <View style={styles.totalsRowFinal}>
            <Text>Total</Text>
            <Text>{presentation.totals.total}</Text>
          </View>
        </View>

        {presentation.notes !== undefined ? (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{presentation.notes}</Text>
          </View>
        ) : undefined}

        <View style={styles.footer} fixed>
          <Text>Generated {presentation.generated}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
