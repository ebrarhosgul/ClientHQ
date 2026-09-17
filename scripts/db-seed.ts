/**
 * Seed a development database with one realistic agency.
 *
 * Run it with `pnpm db:seed`. The dataset is the one spec 0002 names: 1 agency,
 * 2 staff (one admin, one member), 3 clients (one archived), 4 contacts (2
 * accepted, 1 invited and still pending, 1 never invited), 3 projects across
 * statuses, 4 deliverables (2 ready and visible to the client, 1 ready and
 * internal, 1 pending) and 5 invoices, one in each status, each with line
 * items and, for the four that were issued, the event history that got them
 * there (spec 0012). A subscription row is included too, so the access gate
 * has something to read.
 *
 * A second, much smaller agency sits beside it (spec 0008): one admin and a
 * subscription in `past_due` since an hour before the seed ran, so the grace
 * window banner is one seed away in development, and the lockout is one seed
 * plus a week away with nothing else run. It also carries one client of its
 * own, Fernwood Clinic, with one accepted contact bound to the same person as
 * Northwind's Priya Patel (spec 0014).
 *
 * A third agency, Anchor Ridge, is smaller still: one admin, one client
 * (Cinder Media), and a subscription that is simply `canceled`, so it reads as
 * `locked` from the moment the seed runs rather than after a week's wait like
 * the grace org above. Priya holds an accepted row there too, so the client
 * portal's test user has three rows across three agencies: one `full`, one
 * `grace`, one `locked`, which is what the switcher and the locked agency's
 * unavailable page both need to be walked for real (spec 0014, AC-11, AC-16).
 *
 * `E2E_CLERK_CONTACT_USER_ID`, when set, is written as Priya's `clerk_user_id`
 * so every one of her rows binds to a real Clerk development account the
 * browser suite can sign in as (spec 0014, AC-16); unset, she keeps the fixed
 * seed id every other run has used.
 *
 * Every id is a hardcoded constant, and every row is written with "insert, or
 * update on conflict", which is what makes running it twice an update rather
 * than a duplicate.
 *
 * The guard: this writes to `DIRECT_URL` only when its host is `localhost` or
 * the host named in `SEED_ALLOW_HOST`. Anything else exits non zero before a
 * connection is opened, so a production connection string in the wrong
 * terminal changes nothing.
 *
 * Money goes through `src/lib/money.ts`, so the seeded totals satisfy the
 * CHECK constraints the same way real writes will.
 */
import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import { env } from "../src/lib/env";
import { loadEnvFiles } from "../src/lib/load-env-files";
import { invoiceTotals, lineAmountCents } from "../src/lib/money";

loadEnvFiles();

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export type HostCheck =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly problem: string };

/** May the seed write to this connection string? Pure, so it is testable. */
export function checkSeedHost(
  directUrl: string,
  allowHost: string | undefined,
): HostCheck {
  const host = (() => {
    try {
      return new URL(directUrl).hostname;
    } catch {
      return undefined;
    }
  })();

  if (host === undefined || host === "") {
    return { ok: false, problem: "DIRECT_URL is not a valid connection URL." };
  }

  if (host === "localhost" || host === allowHost) {
    return { ok: true, host };
  }

  return {
    ok: false,
    problem:
      `Refusing to seed ${host}. The seed writes only to localhost, or to the host ` +
      `named in SEED_ALLOW_HOST${allowHost ? ` (currently ${allowHost})` : " (not set)"}.`,
  };
}

// ---------------------------------------------------------------------------
// Fixed ids. The version nibble is 7 so they sort like real ids.
// ---------------------------------------------------------------------------

const fixedId = (block: number, n: number): string =>
  `0190a000-0000-7000-8000-${block.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;

const ORG = fixedId(1, 1);
/** The agency in its grace window. */
const PAST_DUE_ORG = fixedId(1, 2);
/** The agency a locked contact's walk needs (spec 0014, AC-16): `canceled`, not time dependent like the grace org above. */
const LOCKED_ORG = fixedId(1, 3);
const USER = {
  admin: fixedId(2, 1),
  member: fixedId(2, 2),
  contactPriya: fixedId(2, 3),
  contactMarcus: fixedId(2, 4),
  pastDueAdmin: fixedId(2, 5),
  lockedAdmin: fixedId(2, 6),
};
const MEMBERSHIP = {
  admin: fixedId(3, 1),
  member: fixedId(3, 2),
  pastDueAdmin: fixedId(3, 3),
  lockedAdmin: fixedId(3, 4),
};
const SUBSCRIPTION = fixedId(4, 1);
const PAST_DUE_SUBSCRIPTION = fixedId(4, 2);
const LOCKED_SUBSCRIPTION = fixedId(4, 3);
const CLIENT = {
  northwind: fixedId(5, 1),
  lumen: fixedId(5, 2),
  archivedHarbor: fixedId(5, 3),
  /** Harbor Lane's own client (spec 0014), not to be confused with `archivedHarbor` above. */
  fernwood: fixedId(5, 4),
  /** Cinder Media, under the locked agency below (spec 0014, AC-16). */
  cinder: fixedId(5, 5),
};
const CONTACT = {
  priya: fixedId(6, 1),
  marcus: fixedId(6, 2),
  invited: fixedId(6, 3),
  notInvited: fixedId(6, 4),
  /** Priya's second accepted row, for Fernwood Clinic under Harbor Lane. */
  priyaFernwood: fixedId(6, 5),
  /** Priya's third accepted row, for Cinder Media under the locked agency. */
  priyaCinder: fixedId(6, 6),
};
const PROJECT = {
  brandRefresh: fixedId(7, 1),
  websiteBuild: fixedId(7, 2),
  launchCampaign: fixedId(7, 3),
};
const DELIVERABLE = {
  logoPack: fixedId(8, 1),
  styleGuide: fixedId(8, 2),
  internalNotes: fixedId(8, 3),
  pendingUpload: fixedId(8, 4),
};
const INVOICE = {
  draft: fixedId(9, 1),
  sent: fixedId(9, 2),
  paid: fixedId(9, 3),
  overdue: fixedId(9, 4),
  void: fixedId(9, 5),
};
const lineId = (invoice: number, position: number): string =>
  fixedId(10, invoice * 100 + position);
const eventId = (invoice: number, n: number): string =>
  fixedId(11, invoice * 100 + n);

// ---------------------------------------------------------------------------
// The dataset, as plain data
// ---------------------------------------------------------------------------

type LineInput = {
  readonly description: string;
  readonly quantity: string;
  readonly unitAmountCents: number;
};

type InvoiceInput = {
  readonly id: string;
  readonly index: number;
  readonly clientId: string;
  readonly status: schema.InvoiceStatus;
  readonly number?: number;
  readonly issueDate?: string;
  readonly dueDate?: string;
  readonly paidAt?: Date;
  readonly taxRateBp: number;
  readonly lines: readonly LineInput[];
};

/** Build one invoice and its line items with totals that satisfy the CHECKs. */
function buildInvoice(input: InvoiceInput): {
  readonly invoice: typeof schema.invoices.$inferInsert;
  readonly lineItems: readonly (typeof schema.invoiceLineItems.$inferInsert)[];
} {
  const lineItems = input.lines.map((line, index) => ({
    id: lineId(input.index, index + 1),
    orgId: ORG,
    invoiceId: input.id,
    description: line.description,
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    amountCents: lineAmountCents(line.quantity, line.unitAmountCents),
    position: index + 1,
  }));

  const totals = invoiceTotals(
    lineItems.map((line) => line.amountCents),
    input.taxRateBp,
  );

  return {
    invoice: {
      id: input.id,
      orgId: ORG,
      clientId: input.clientId,
      number: input.number,
      status: input.status,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: "USD",
      taxRateBp: input.taxRateBp,
      paidAt: input.paidAt,
      ...totals,
    },
    lineItems,
  };
}

const INVOICES: readonly InvoiceInput[] = [
  {
    id: INVOICE.draft,
    index: 1,
    clientId: CLIENT.northwind,
    status: "draft",
    taxRateBp: 2000,
    lines: [
      {
        description: "Discovery workshop",
        quantity: "1",
        unitAmountCents: 180000,
      },
      {
        description: "Design revisions",
        quantity: "3.5",
        unitAmountCents: 12500,
      },
    ],
  },
  {
    id: INVOICE.sent,
    index: 2,
    clientId: CLIENT.northwind,
    status: "sent",
    number: 1,
    issueDate: "2026-08-20",
    dueDate: "2026-09-19",
    taxRateBp: 2000,
    lines: [
      {
        description: "Brand refresh, phase one",
        quantity: "1",
        unitAmountCents: 450000,
      },
      {
        description: "Stock photography licences",
        quantity: "12",
        unitAmountCents: 4900,
      },
    ],
  },
  {
    id: INVOICE.paid,
    index: 3,
    clientId: CLIENT.lumen,
    status: "paid",
    number: 2,
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    paidAt: new Date("2026-07-28T14:05:00Z"),
    taxRateBp: 0,
    lines: [
      {
        description: "Website build, milestone one",
        quantity: "1",
        unitAmountCents: 820000,
      },
      { description: "Hosting setup", quantity: "2.25", unitAmountCents: 9000 },
    ],
  },
  {
    id: INVOICE.overdue,
    index: 4,
    clientId: CLIENT.lumen,
    status: "overdue",
    number: 3,
    issueDate: "2026-07-15",
    dueDate: "2026-08-14",
    taxRateBp: 1500,
    lines: [
      {
        description: "Website build, milestone two",
        quantity: "1",
        unitAmountCents: 640000,
      },
      { description: "Copywriting", quantity: "0.5", unitAmountCents: 15000 },
    ],
  },
  {
    id: INVOICE.void,
    index: 5,
    clientId: CLIENT.archivedHarbor,
    status: "void",
    number: 4,
    issueDate: "2026-06-02",
    dueDate: "2026-07-02",
    taxRateBp: 2000,
    lines: [
      { description: "Retainer, June", quantity: "1", unitAmountCents: 250000 },
    ],
  },
];

/**
 * What happened to each issued invoice, in order (spec 0012, AC-18). The draft
 * has no history yet, which is the honest history of a draft. Timestamps are
 * fixed so a second run rewrites the same rows rather than adding a second
 * copy of the story.
 */
const INVOICE_EVENTS: readonly (typeof schema.invoiceEvents.$inferInsert)[] = [
  // INV-0001, sent to Northwind and still open.
  {
    id: eventId(2, 1),
    orgId: ORG,
    invoiceId: INVOICE.sent,
    kind: "issued",
    fromStatus: "draft",
    toStatus: "sent",
    actorUserId: USER.admin,
    createdAt: new Date("2026-08-20T09:12:00Z"),
  },
  {
    id: eventId(2, 2),
    orgId: ORG,
    invoiceId: INVOICE.sent,
    kind: "notified",
    actorUserId: USER.admin,
    note: "delivered: priya.patel@northwind.example, devon.reyes@northwind.example",
    createdAt: new Date("2026-08-20T09:12:04Z"),
  },
  // INV-0002, Lumen, paid four weeks after issue.
  {
    id: eventId(3, 1),
    orgId: ORG,
    invoiceId: INVOICE.paid,
    kind: "issued",
    fromStatus: "draft",
    toStatus: "sent",
    actorUserId: USER.member,
    createdAt: new Date("2026-07-01T10:30:00Z"),
  },
  {
    id: eventId(3, 2),
    orgId: ORG,
    invoiceId: INVOICE.paid,
    kind: "notified",
    actorUserId: USER.member,
    note: "delivered: marcus.lindqvist@lumen.example, finance@lumen.example",
    createdAt: new Date("2026-07-01T10:30:03Z"),
  },
  {
    id: eventId(3, 3),
    orgId: ORG,
    invoiceId: INVOICE.paid,
    kind: "paid",
    fromStatus: "sent",
    toStatus: "paid",
    actorUserId: USER.admin,
    createdAt: new Date("2026-07-28T14:05:00Z"),
  },
  // INV-0003, Lumen, moved to overdue by the nightly sweep (no actor).
  {
    id: eventId(4, 1),
    orgId: ORG,
    invoiceId: INVOICE.overdue,
    kind: "issued",
    fromStatus: "draft",
    toStatus: "sent",
    actorUserId: USER.member,
    createdAt: new Date("2026-07-15T16:45:00Z"),
  },
  {
    id: eventId(4, 2),
    orgId: ORG,
    invoiceId: INVOICE.overdue,
    kind: "notification_failed",
    actorUserId: USER.member,
    note: "delivered: marcus.lindqvist@lumen.example; failed: finance@lumen.example (mailbox full)",
    createdAt: new Date("2026-07-15T16:45:05Z"),
  },
  {
    id: eventId(4, 3),
    orgId: ORG,
    invoiceId: INVOICE.overdue,
    kind: "notified",
    actorUserId: USER.member,
    note: "delivered: marcus.lindqvist@lumen.example, finance@lumen.example",
    createdAt: new Date("2026-07-15T17:02:00Z"),
  },
  {
    id: eventId(4, 4),
    orgId: ORG,
    invoiceId: INVOICE.overdue,
    kind: "overdue",
    fromStatus: "sent",
    toStatus: "overdue",
    createdAt: new Date("2026-08-15T03:00:00Z"),
  },
  // INV-0004, Harbor Books, voided when the client was archived.
  {
    id: eventId(5, 1),
    orgId: ORG,
    invoiceId: INVOICE.void,
    kind: "issued",
    fromStatus: "draft",
    toStatus: "sent",
    actorUserId: USER.admin,
    createdAt: new Date("2026-06-02T08:00:00Z"),
  },
  {
    id: eventId(5, 2),
    orgId: ORG,
    invoiceId: INVOICE.void,
    kind: "notification_failed",
    actorUserId: USER.admin,
    note: "no contacts to notify",
    createdAt: new Date("2026-06-02T08:00:02Z"),
  },
  {
    id: eventId(5, 3),
    orgId: ORG,
    invoiceId: INVOICE.void,
    kind: "voided",
    fromStatus: "sent",
    toStatus: "void",
    actorUserId: USER.admin,
    note: "Engagement ended before the retainer started.",
    createdAt: new Date("2026-06-10T11:20:00Z"),
  },
];

function dataset() {
  const built = INVOICES.map(buildInvoice);
  const priyaClerkUserId = env().E2E_CLERK_CONTACT_USER_ID ?? "user_seed_priya";

  return {
    organizations: [
      {
        id: ORG,
        clerkOrgId: "org_seed_studio_north",
        name: "Studio North",
        slug: "studio-north",
        // Four invoices have been issued, so the next one takes 5.
        nextInvoiceNumber: 5,
        defaultCurrency: "USD",
      },
      {
        id: PAST_DUE_ORG,
        clerkOrgId: "org_seed_harbor_lane",
        name: "Harbor Lane",
        slug: "harbor-lane",
        defaultCurrency: "USD",
      },
      {
        id: LOCKED_ORG,
        clerkOrgId: "org_seed_anchor_ridge",
        name: "Anchor Ridge",
        slug: "anchor-ridge",
        defaultCurrency: "USD",
      },
    ] satisfies (typeof schema.organizations.$inferInsert)[],

    users: [
      {
        id: USER.admin,
        clerkUserId: "user_seed_admin",
        email: "sarah.chen@studio-north.example",
        name: "Sarah Chen",
      },
      {
        id: USER.member,
        clerkUserId: "user_seed_member",
        email: "james.okafor@studio-north.example",
        name: "James Okafor",
      },
      {
        id: USER.contactPriya,
        clerkUserId: priyaClerkUserId,
        email: "priya.patel@northwind.example",
        name: "Priya Patel",
      },
      {
        id: USER.contactMarcus,
        clerkUserId: "user_seed_marcus",
        email: "marcus.lindqvist@lumen.example",
        name: "Marcus Lindqvist",
      },
      {
        id: USER.pastDueAdmin,
        clerkUserId: "user_seed_harbor_admin",
        email: "dana.reyes@harbor-lane.example",
        name: "Dana Reyes",
      },
      {
        id: USER.lockedAdmin,
        clerkUserId: "user_seed_locked_admin",
        email: "morgan.blake@anchor-ridge.example",
        name: "Morgan Blake",
      },
    ] satisfies (typeof schema.users.$inferInsert)[],

    memberships: [
      { id: MEMBERSHIP.admin, orgId: ORG, userId: USER.admin, role: "admin" },
      {
        id: MEMBERSHIP.member,
        orgId: ORG,
        userId: USER.member,
        role: "member",
      },
      {
        id: MEMBERSHIP.pastDueAdmin,
        orgId: PAST_DUE_ORG,
        userId: USER.pastDueAdmin,
        role: "admin",
      },
      {
        id: MEMBERSHIP.lockedAdmin,
        orgId: LOCKED_ORG,
        userId: USER.lockedAdmin,
        role: "admin",
      },
    ] satisfies (typeof schema.memberships.$inferInsert)[],

    subscriptions: [
      {
        id: SUBSCRIPTION,
        orgId: ORG,
        stripeCustomerId: "cus_seed_studio_north",
        stripeSubscriptionId: "sub_seed_studio_north",
        stripePriceId: "price_seed_monthly",
        status: "active",
        currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
      },
      {
        id: PAST_DUE_SUBSCRIPTION,
        orgId: PAST_DUE_ORG,
        stripeCustomerId: "cus_seed_harbor_lane",
        stripeSubscriptionId: "sub_seed_harbor_lane",
        stripePriceId: "price_seed_monthly",
        status: "past_due",
        currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
        // Relative to the seed, so the window is open now and lapses on its
        // own in a week: `grace` today, `locked` after 7 days, no job needed.
        pastDueSince: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        id: LOCKED_SUBSCRIPTION,
        orgId: LOCKED_ORG,
        stripeCustomerId: "cus_seed_anchor_ridge",
        stripeSubscriptionId: "sub_seed_anchor_ridge",
        stripePriceId: "price_seed_monthly",
        // `canceled` locks unconditionally (`src/access/level.ts`), with no
        // clock to wait on, unlike the grace org's `past_due` above.
        status: "canceled",
        currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
      },
    ] satisfies (typeof schema.subscriptions.$inferInsert)[],

    clients: [
      {
        id: CLIENT.northwind,
        orgId: ORG,
        name: "Northwind Traders",
        companyEmail: "hello@northwind.example",
        notes: "Prefers video calls on Tuesdays.",
      },
      {
        id: CLIENT.lumen,
        orgId: ORG,
        name: "Lumen Health",
        companyEmail: "accounts@lumen.example",
      },
      {
        id: CLIENT.archivedHarbor,
        orgId: ORG,
        name: "Harbor & Co",
        companyEmail: "team@harbor.example",
        notes: "Engagement ended June 2026.",
        archivedAt: new Date("2026-07-05T09:00:00Z"),
      },
      {
        id: CLIENT.fernwood,
        orgId: PAST_DUE_ORG,
        name: "Fernwood Clinic",
        companyEmail: "hello@fernwood-clinic.example",
      },
      {
        id: CLIENT.cinder,
        orgId: LOCKED_ORG,
        name: "Cinder Media",
        companyEmail: "hello@cinder-media.example",
      },
    ] satisfies (typeof schema.clients.$inferInsert)[],

    clientContacts: [
      {
        id: CONTACT.priya,
        orgId: ORG,
        clientId: CLIENT.northwind,
        userId: USER.contactPriya,
        email: "priya.patel@northwind.example",
        name: "Priya Patel",
        invitedAt: new Date("2026-08-01T10:00:00Z"),
        acceptedAt: new Date("2026-08-01T16:20:00Z"),
      },
      {
        id: CONTACT.marcus,
        orgId: ORG,
        clientId: CLIENT.lumen,
        userId: USER.contactMarcus,
        email: "marcus.lindqvist@lumen.example",
        name: "Marcus Lindqvist",
        invitedAt: new Date("2026-06-20T10:00:00Z"),
        acceptedAt: new Date("2026-06-21T08:05:00Z"),
      },
      {
        id: CONTACT.invited,
        orgId: ORG,
        clientId: CLIENT.northwind,
        email: "devon.reyes@northwind.example",
        name: "Devon Reyes",
        // A hash shaped placeholder. No real token corresponds to it.
        inviteTokenHash:
          "9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
        inviteExpiresAt: new Date("2026-09-12T10:00:00Z"),
        invitedAt: new Date("2026-09-05T10:00:00Z"),
      },
      {
        id: CONTACT.notInvited,
        orgId: ORG,
        clientId: CLIENT.lumen,
        email: "finance@lumen.example",
        name: "Lumen Finance",
      },
      {
        id: CONTACT.priyaFernwood,
        orgId: PAST_DUE_ORG,
        clientId: CLIENT.fernwood,
        userId: USER.contactPriya,
        email: "priya.patel@fernwood-clinic.example",
        name: "Priya Patel",
        // Accepted before the Northwind row below, on purpose: the fallback
        // resolver (spec 0003, AC-5) picks the most recently accepted row
        // with no cookie, and the walk's "lands on the Northwind overview"
        // (spec 0014, AC-16) depends on Northwind staying that default.
        invitedAt: new Date("2026-07-20T10:00:00Z"),
        acceptedAt: new Date("2026-07-20T16:00:00Z"),
      },
      {
        id: CONTACT.priyaCinder,
        orgId: LOCKED_ORG,
        clientId: CLIENT.cinder,
        userId: USER.contactPriya,
        email: "priya.patel@cinder-media.example",
        name: "Priya Patel",
        // Accepted before both rows above, so Northwind stays the
        // cookie-less fallback (see the note on the Fernwood row).
        invitedAt: new Date("2026-07-01T10:00:00Z"),
        acceptedAt: new Date("2026-07-01T16:00:00Z"),
      },
    ] satisfies (typeof schema.clientContacts.$inferInsert)[],

    projects: [
      {
        id: PROJECT.brandRefresh,
        orgId: ORG,
        clientId: CLIENT.northwind,
        name: "Brand refresh",
        description: "New identity, guidelines and asset pack.",
        status: "in_review",
        dueDate: "2026-09-30",
      },
      {
        id: PROJECT.websiteBuild,
        orgId: ORG,
        clientId: CLIENT.lumen,
        name: "Website build",
        description: "Marketing site on the new brand.",
        status: "in_progress",
        dueDate: "2026-11-15",
      },
      {
        id: PROJECT.launchCampaign,
        orgId: ORG,
        clientId: CLIENT.northwind,
        name: "Launch campaign",
        status: "planning",
      },
    ] satisfies (typeof schema.projects.$inferInsert)[],

    deliverables: [
      {
        id: DELIVERABLE.logoPack,
        orgId: ORG,
        projectId: PROJECT.brandRefresh,
        name: "Logo pack.zip",
        r2Key: `org/${ORG}/project/${PROJECT.brandRefresh}/${DELIVERABLE.logoPack}`,
        contentType: "application/zip",
        sizeBytes: 48_213_904,
        uploadedByUserId: USER.admin,
        visibleToClient: true,
        status: "ready",
      },
      {
        id: DELIVERABLE.styleGuide,
        orgId: ORG,
        projectId: PROJECT.brandRefresh,
        name: "Style guide v2.pdf",
        r2Key: `org/${ORG}/project/${PROJECT.brandRefresh}/${DELIVERABLE.styleGuide}`,
        contentType: "application/pdf",
        sizeBytes: 6_402_118,
        uploadedByUserId: USER.member,
        visibleToClient: true,
        status: "ready",
      },
      {
        id: DELIVERABLE.internalNotes,
        orgId: ORG,
        projectId: PROJECT.websiteBuild,
        name: "Internal QA notes.md",
        r2Key: `org/${ORG}/project/${PROJECT.websiteBuild}/${DELIVERABLE.internalNotes}`,
        contentType: "text/markdown",
        sizeBytes: 12_880,
        uploadedByUserId: USER.member,
        visibleToClient: false,
        status: "ready",
      },
      {
        id: DELIVERABLE.pendingUpload,
        orgId: ORG,
        projectId: PROJECT.websiteBuild,
        name: "Homepage hero.mp4",
        r2Key: `org/${ORG}/project/${PROJECT.websiteBuild}/${DELIVERABLE.pendingUpload}`,
        contentType: "video/mp4",
        sizeBytes: 0,
        uploadedByUserId: USER.admin,
        visibleToClient: true,
        status: "pending",
      },
    ] satisfies (typeof schema.deliverables.$inferInsert)[],

    invoices: built.map((entry) => entry.invoice),
    invoiceLineItems: built.flatMap((entry) => entry.lineItems),
    invoiceEvents: INVOICE_EVENTS,
  };
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type InsertKey<T extends PgTable> = Extract<keyof T["$inferInsert"], string>;

/** Is `key` one of this table's columns? A type predicate, so no cast is needed. */
function isInsertKey<T extends PgTable>(
  table: T,
  key: string,
): key is InsertKey<T> {
  return key in getTableColumns(table);
}

/**
 * The `set` clause for "update on conflict": every column except `id`, each
 * set to the incoming value (`excluded.<column>`), so a changed seed overwrites
 * what an earlier run wrote.
 */
function excludedColumns<T extends PgTable>(table: T): PgUpdateSetSource<T> {
  const columns = getTableColumns(table);

  return Object.keys(columns)
    .filter((key) => isInsertKey(table, key))
    .filter((key) => key !== "id")
    .reduce<PgUpdateSetSource<T>>(
      (set, key) => ({
        ...set,
        [key]: sql`excluded.${sql.identifier(columns[key].name)}`,
      }),
      {},
    );
}

/** Insert every row, or update it in place when its id already exists. */
async function upsertAll<
  T extends PgTable & { id: PgTable["_"]["columns"][string] },
>(tx: Tx, table: T, rows: readonly T["$inferInsert"][]): Promise<number> {
  if (rows.length === 0) return 0;

  await tx
    .insert(table)
    .values([...rows])
    .onConflictDoUpdate({ target: table.id, set: excludedColumns(table) });

  return rows.length;
}

async function main(): Promise<number> {
  const { DIRECT_URL, SEED_ALLOW_HOST } = env();

  const allowed = checkSeedHost(DIRECT_URL, SEED_ALLOW_HOST);
  if (!allowed.ok) {
    console.error(allowed.problem);
    return 1;
  }

  const data = dataset();
  const client = postgres(DIRECT_URL, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const counts = await db.transaction(async (tx) => ({
      organizations: await upsertAll(
        tx,
        schema.organizations,
        data.organizations,
      ),
      users: await upsertAll(tx, schema.users, data.users),
      memberships: await upsertAll(tx, schema.memberships, data.memberships),
      subscriptions: await upsertAll(
        tx,
        schema.subscriptions,
        data.subscriptions,
      ),
      clients: await upsertAll(tx, schema.clients, data.clients),
      client_contacts: await upsertAll(
        tx,
        schema.clientContacts,
        data.clientContacts,
      ),
      projects: await upsertAll(tx, schema.projects, data.projects),
      deliverables: await upsertAll(tx, schema.deliverables, data.deliverables),
      invoices: await upsertAll(tx, schema.invoices, data.invoices),
      invoice_line_items: await upsertAll(
        tx,
        schema.invoiceLineItems,
        data.invoiceLineItems,
      ),
      invoice_events: await upsertAll(
        tx,
        schema.invoiceEvents,
        data.invoiceEvents,
      ),
    }));

    console.log(`Seeded ${allowed.host}:`);
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(24)} ${count}`);
    }
    return 0;
  } finally {
    await client.end();
  }
}

// Only run when executed directly, so the guard can be imported by a test.
if (process.argv[1]?.endsWith("db-seed.ts")) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error("Seeding failed; the transaction was rolled back.");
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
