import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * The email a client contact receives when an invoice is issued to their
 * company (spec 0012, AC-6): the agency name, the display number, the total
 * with its currency, the issue and due dates, the notes, and a button to the
 * portal.
 *
 * Inline styles and a fixed palette, deliberately, for the same reason as
 * `client-invitation.tsx`: email clients ignore stylesheets and there is no
 * theme to follow in an inbox. The URL is written out below the button so a
 * client that strips buttons still shows a way in.
 *
 * Subject and envelope are composed by `src/invoices/invoice-email.ts`, not
 * here: this file is the body only.
 */
export type InvoiceIssuedEmailProps = {
  readonly agencyName: string;
  readonly contactName: string;
  /** `INV-0001`. */
  readonly displayNumber: string;
  /** Already formatted with the invoice's currency, e.g. `$1,234.56`. */
  readonly total: string;
  readonly currency: string;
  /** Already formatted as UTC calendar dates. */
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly notes: string | null;
  readonly portalUrl: string;
};

const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const styles = {
  body: { backgroundColor: "#f6f5f3", fontFamily: FONT, margin: 0 },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e6e3de",
    borderRadius: "6px",
    margin: "32px auto",
    maxWidth: "520px",
    padding: "32px",
  },
  brand: {
    color: "#6b675f",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    margin: "0 0 20px",
    textTransform: "uppercase" as const,
  },
  heading: {
    color: "#1c1b18",
    fontSize: "20px",
    fontWeight: 600,
    lineHeight: "28px",
    margin: "0 0 16px",
  },
  text: {
    color: "#3d3a34",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 16px",
  },
  detail: {
    color: "#1c1b18",
    fontSize: "14px",
    fontWeight: 500,
    lineHeight: "22px",
    margin: "0 0 4px",
  },
  label: {
    color: "#6b675f",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 400,
    minWidth: "96px",
  },
  total: {
    color: "#1c1b18",
    fontSize: "20px",
    fontWeight: 600,
    lineHeight: "28px",
  },
  notes: {
    backgroundColor: "#f6f5f3",
    borderRadius: "6px",
    color: "#3d3a34",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "16px 0",
    padding: "12px 16px",
    whiteSpace: "pre-wrap" as const,
  },
  button: {
    backgroundColor: "#0f8a8a",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 18px",
    textDecoration: "none",
  },
  link: { color: "#0f8a8a", fontSize: "12px", wordBreak: "break-all" as const },
  muted: {
    color: "#6b675f",
    fontSize: "12px",
    lineHeight: "18px",
    margin: "16px 0 0",
  },
  hr: { borderColor: "#e6e3de", margin: "24px 0" },
} as const;

export function InvoiceIssuedEmail({
  agencyName,
  contactName,
  displayNumber,
  total,
  currency,
  issuedOn,
  dueOn,
  notes,
  portalUrl,
}: InvoiceIssuedEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Invoice ${displayNumber} from ${agencyName}: ${total} due ${dueOn}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>ClientHQ</Text>
          <Heading as="h1" style={styles.heading}>
            Invoice {displayNumber} from {agencyName}
          </Heading>
          <Text style={styles.text}>Hi {contactName},</Text>
          <Text style={styles.text}>
            {agencyName} has issued you an invoice. Here is what it says.
          </Text>
          <Text style={styles.detail}>
            <span style={styles.label}>Invoice</span> {displayNumber}
          </Text>
          <Text style={styles.detail}>
            <span style={styles.label}>Total due</span>{" "}
            <span style={styles.total}>{total}</span> {currency}
          </Text>
          <Text style={styles.detail}>
            <span style={styles.label}>Issued</span> {issuedOn}
          </Text>
          <Text style={styles.detail}>
            <span style={styles.label}>Due</span> {dueOn}
          </Text>
          {notes ? <Text style={styles.notes}>{notes}</Text> : undefined}
          <Section style={{ margin: "24px 0" }}>
            <Button href={portalUrl} style={styles.button}>
              View invoice
            </Button>
          </Section>
          <Text style={styles.text}>
            If the button does not work, open this link:
            <br />
            <Link href={portalUrl} style={styles.link}>
              {portalUrl}
            </Link>
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.muted}>
            You are receiving this because {agencyName} lists you as a contact
            for their client portal. Reply to this email to reach them; no
            payment is taken through ClientHQ.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
