/**
 * The one way the product sends email (spec 0009, AC-5, AC-6).
 *
 * A message is a React Email element plus its envelope. It is rendered here to
 * both HTML and plain text and handed to Resend, or, when no key is set outside
 * production, printed to the server console so the flow can be walked with no
 * provider account. Either way the caller gets a `Result`: the transport never
 * throws, because a send that failed is a business outcome the action has to
 * render, not a bug.
 *
 * Every send carries an idempotency key of the form
 * `<event>/<entity id>/<version>`, so a retried call cannot deliver the same
 * message twice and a new version of the message is a new key. Feature 13's
 * invoice email follows the same convention.
 *
 * This module is a side effect on purpose and lives at the edge: nothing in
 * `src/contacts/` composes HTML or talks to Resend directly.
 */
import { render } from "@react-email/render";
import { Resend } from "resend";
import type { ReactElement } from "react";

import { failure, ok, type Result } from "@/db/tenant/errors";
import { env, isEmailConfigured } from "@/lib/env";

export type EmailAddress = {
  readonly address: string;
  /** Composed per send and never stored: `<Agency> via ClientHQ`. */
  readonly name?: string;
};

export type EmailMessage = {
  readonly to: string;
  readonly from: EmailAddress;
  readonly replyTo?: string;
  readonly subject: string;
  readonly react: ReactElement;
  /** `<event>/<entity id>/<version>`, at most 256 characters. */
  readonly idempotencyKey: string;
};

export type SentEmail = {
  /** The provider's id, or a fake one from the console transport. */
  readonly id: string;
};

/** Everything a transport needs, with the React already rendered. */
export type RenderedEmail = {
  readonly to: string;
  readonly from: string;
  readonly replyTo: string | undefined;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly idempotencyKey: string;
};

/**
 * `Name <address>`, with the name quoted and anything that could break the
 * header stripped. An agency can call itself whatever it likes; it cannot
 * inject a second address.
 */
export function formatAddress({ address, name }: EmailAddress): string {
  if (name === undefined) {
    return address;
  }

  const safe = name.replace(/["<>\r\n]/gu, "").trim();

  return safe === "" ? address : `"${safe}" <${address}>`;
}

export async function renderEmail(
  message: EmailMessage,
): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(message.react),
    render(message.react, { plainText: true }),
  ]);

  return {
    to: message.to,
    from: formatAddress(message.from),
    replyTo: message.replyTo,
    subject: message.subject,
    html,
    text,
    idempotencyKey: message.idempotencyKey,
  };
}

const UNAVAILABLE = {
  code: "unavailable",
  message: "The email could not be sent. Try again in a moment.",
} as const;

/**
 * The console transport: the message, printed where a developer is looking.
 *
 * This is the email itself in a development environment, not a log line about
 * it, which is why it carries the recipient and the body (with the link) that
 * AC-15 keeps out of the structured lines.
 */
function sendToConsole(rendered: RenderedEmail): Result<SentEmail> {
  const id = `console-${rendered.idempotencyKey}`;

  console.info(
    [
      "",
      "─".repeat(72),
      `[email] console transport (RESEND_API_KEY is not set)`,
      `To:       ${rendered.to}`,
      `From:     ${rendered.from}`,
      ...(rendered.replyTo === undefined
        ? []
        : [`Reply-To: ${rendered.replyTo}`]),
      `Subject:  ${rendered.subject}`,
      `Key:      ${rendered.idempotencyKey}`,
      "",
      rendered.text,
      "─".repeat(72),
      "",
    ].join("\n"),
  );

  return ok({ id });
}

async function sendWithResend(
  rendered: RenderedEmail,
  apiKey: string,
): Promise<Result<SentEmail>> {
  const resend = new Resend(apiKey);

  try {
    // The SDK reports API failures in `error` and only throws on transport
    // failures; both are the same outcome for the caller.
    const { data, error } = await resend.emails.send(
      {
        from: rendered.from,
        to: [rendered.to],
        replyTo: rendered.replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      { idempotencyKey: rendered.idempotencyKey },
    );

    if (error !== null || data === null) {
      return failure(UNAVAILABLE);
    }

    return ok({ id: data.id });
  } catch {
    return failure(UNAVAILABLE);
  }
}

/**
 * Send one message. Never throws; `unavailable` when the provider refuses or
 * cannot be reached.
 */
export async function sendEmail(
  message: EmailMessage,
): Promise<Result<SentEmail>> {
  const rendered = await renderEmail(message);

  if (!isEmailConfigured()) {
    return sendToConsole(rendered);
  }

  // Non null by construction: `isEmailConfigured()` just read it.
  const apiKey = env().RESEND_API_KEY ?? "";

  return sendWithResend(rendered, apiKey);
}
