/**
 * One structured line per invitation event (spec 0009, AC-15).
 *
 * Every send, send failure, revoke, remove and accept writes exactly one line
 * carrying the organization id, the contact id and the outcome, and never the
 * token, the digest or an email address. The two ids are optional only for an
 * accept refused before a row was found, when there is nothing to name.
 *
 * `console`, like `src/db/tenant/log.ts`: Vercel collects stdout, and error
 * tracking is feature 20's decision.
 */

export const CONTACT_OPERATIONS = [
  "send",
  "send_failed",
  "revoke",
  "remove",
  "accept",
] as const;

export type ContactOperation = (typeof CONTACT_OPERATIONS)[number];

export type ContactLogDetails = {
  readonly operation: ContactOperation;
  /** A short word: `sent`, `provider_refused`, `accepted`, `refused`, ... */
  readonly outcome: string;
  readonly orgId?: string;
  readonly contactId?: string;
};

export type ContactLogLine = ContactLogDetails & {
  readonly event: "contacts.invitation";
  readonly at: string;
};

export function logContactEvent(details: ContactLogDetails): void {
  const line: ContactLogLine = {
    event: "contacts.invitation",
    ...details,
    at: new Date().toISOString(),
  };

  // One call, so one line. JSON.stringify drops the undefined ids.
  console.info(JSON.stringify(line));
}
