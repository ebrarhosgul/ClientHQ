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
} from "react-email";

/**
 * The invitation a client contact receives (spec 0009, AC-5).
 *
 * Inline styles and a fixed palette, deliberately: email clients ignore
 * stylesheets and there is no theme to follow in an inbox. The colours are the
 * product's light palette by eye (warm neutrals, teal accent), and the only
 * thing that matters for accessibility here is that the link is a real link
 * with the URL written out as text below the button, so a client that strips
 * buttons still shows a way in.
 *
 * Subject and envelope are composed by `sendInvitation`, not here: this file
 * is the body only.
 */
export type ClientInvitationEmailProps = {
  readonly agencyName: string;
  readonly clientName: string;
  readonly contactName: string;
  readonly acceptUrl: string;
  /** Already formatted as a UTC calendar date, e.g. `19 September 2026 (UTC)`. */
  readonly expiresOn: string;
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

export function ClientInvitationEmail({
  agencyName,
  clientName,
  contactName,
  acceptUrl,
  expiresOn,
}: ClientInvitationEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${agencyName} invited you to their client portal`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>ClientHQ</Text>
          <Heading as="h1" style={styles.heading}>
            {agencyName} invited you to their client portal
          </Heading>
          <Text style={styles.text}>Hi {contactName},</Text>
          <Text style={styles.text}>
            {agencyName} uses ClientHQ to share the projects, files and invoices
            for <strong>{clientName}</strong>. Accept this invitation to see
            them in your own portal.
          </Text>
          <Section style={{ margin: "24px 0" }}>
            <Button href={acceptUrl} style={styles.button}>
              Accept invitation
            </Button>
          </Section>
          <Text style={styles.text}>
            If the button does not work, open this link:
            <br />
            <Link href={acceptUrl} style={styles.link}>
              {acceptUrl}
            </Link>
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.muted}>
            This link works until {expiresOn} and can be used once. You will be
            asked to sign in or create an account with the email address this
            was sent to. If you were not expecting this, you can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
