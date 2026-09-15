import type { Metadata } from "next";

import { AuthCard } from "@/auth/ui/auth-card";
import { AuthFrame } from "@/auth/ui/auth-frame";
import { isClientContact } from "@/auth/context";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Your invoice",
};

/**
 * Where the issue email's button lands (spec 0012, AC-16).
 *
 * **A placeholder. Feature 15, "Client portal", replaces this file.** It
 * exists so the link in the email never lands on a bare 404. It requires a
 * signed in client contact (the proxy already requires a session on
 * `/portal/*`; a signed in agency member with no contact row gets the same
 * message) and reads no invoice data at all. It deliberately does not check
 * that the id belongs to that contact's client, because there is nothing to
 * protect yet: feature 15 must add that check the moment it shows data.
 *
 * It borrows the `(auth)` frame so the landing is a finished surface rather
 * than a bare message, as `/portal` does.
 */
export default async function PortalInvoicePlaceholder() {
  const contact = isClerkConfigured() ? await isClientContact() : false;

  return (
    <AuthFrame>
      <AuthCard
        title={
          contact
            ? "Your invoice is on its way here"
            : "Sign in as a client contact"
        }
        description={
          contact
            ? "This is where you will be able to read the invoice your agency issued to you, line by line, and download it."
            : "Invoices are shown to the client contacts an agency has invited. Sign in with the email address the invitation was sent to."
        }
        footer="Nothing is missing from your account. The invoice view in ClientHQ is still being built, and the email you received carries the amount and the due date."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          {contact
            ? "You are signed in, and your agency has you on their list. There is nothing you need to do."
            : "If you were not expecting an invoice, you can ignore the email that brought you here."}
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
