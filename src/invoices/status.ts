/**
 * The invoice lifecycle rule, in one pure module read by the page (which
 * buttons to render), the actions (which moves to allow), the client portal
 * (which statuses a contact may see) and the nightly sweep (spec 0012, State
 * transitions and Key invariants). One module, so none of them can drift.
 *
 * ```
 * draft ──issue──▶ sent ──mark paid──▶ paid
 *   │               │  └──sweep (due date passed)──▶ overdue ──mark paid──▶ paid
 *   │               │                                   │
 *   └──void──▶ void ◀──void────────────────────────────┘
 * ```
 *
 * `paid` and `void` are final: no transition leaves them.
 */
import { INVOICE_STATUSES, type InvoiceStatus } from "@/db/schema";

export { INVOICE_STATUSES };

/** How many days after issue an invoice falls due, for the draft's prefill. */
export const DEFAULT_TERMS_DAYS = 30;

/** The most lines one invoice may carry (AC-3). */
export const MAX_LINES_PER_INVOICE = 100;

/**
 * The statuses a client contact may ever see. Feature 15 applies this in
 * every contact side invoice query; drafts and voided invoices never reach a
 * contact (AC-16).
 */
export const CLIENT_VISIBLE_STATUSES = ["sent", "overdue", "paid"] as const;

export type ClientVisibleStatus = (typeof CLIENT_VISIBLE_STATUSES)[number];

export function isClientVisible(
  status: InvoiceStatus,
): status is ClientVisibleStatus {
  return (CLIENT_VISIBLE_STATUSES as readonly InvoiceStatus[]).includes(status);
}

/** Every move the lifecycle allows, keyed by where it starts. */
const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ["sent", "void"],
  sent: ["paid", "overdue", "void"],
  overdue: ["paid", "void"],
  paid: [],
  void: [],
};

/** Whether `from` → `to` is one of the moves the lifecycle allows. */
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The staff actions the detail page offers. `overdue` is the sweep's, never a button. */
export const INVOICE_ACTIONS = [
  "issue",
  "void",
  "mark_paid",
  "resend",
] as const;

export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

const ACTIONS: Readonly<Record<InvoiceStatus, readonly InvoiceAction[]>> = {
  draft: ["issue", "void"],
  sent: ["mark_paid", "void", "resend"],
  overdue: ["mark_paid", "void", "resend"],
  paid: [],
  void: [],
};

/** Exactly the buttons the detail page renders for this status (AC-11). */
export function nextActions(status: InvoiceStatus): readonly InvoiceAction[] {
  return ACTIONS[status];
}

/** The statuses from which a given action is allowed, for the actions' input schemas. */
export function statusesAllowing(
  action: InvoiceAction,
): readonly InvoiceStatus[] {
  return INVOICE_STATUSES.filter((status) => ACTIONS[status].includes(action));
}

/**
 * "Past due" is derived, never stored: a `sent` invoice whose due date is
 * before today. Only `sent`, because `overdue` already says it and the
 * others are not owed. `todayUtc` is a parameter so a test can fix it and
 * every caller agrees on what day it is; due today is not past due (AC-12).
 */
export function isPastDue(
  status: InvoiceStatus,
  dueDate: string | null,
  todayUtc: string,
): boolean {
  return status === "sent" && dueDate !== null && dueDate < todayUtc;
}

/**
 * `INV-` plus the number zero padded to four digits: `INV-0001`, `INV-9999`,
 * `INV-10000`. Derived from the stored integer, never stored itself.
 */
export function formatInvoiceNumber(number: number): string {
  return `INV-${String(number).padStart(4, "0")}`;
}

/** The display number, or "Draft" while there is none yet. */
export function displayNumber(number: number | null): string {
  return number === null ? "Draft" : formatInvoiceNumber(number);
}
