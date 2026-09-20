/**
 * The seeded story, as plain data: Apex Interactive Studio and everything
 * under it, plus two small agencies for the access gate's other states.
 *
 * Pure given a clock. `buildDataset({ now })` reads no environment and opens no
 * connection, so the tests fix "now" and read the rows back, and
 * `scripts/db-seed.ts` is left with only the writing. Every timestamp is
 * relative to `now` and lies inside the 60 days before it.
 *
 * See `scripts/db-seed.ts` for what the dataset contains and why.
 */
import * as schema from "../src/db/schema";
import { invoiceTotals, lineAmountCents } from "../src/lib/money";
import { contentTypeFor, mockFileBytes } from "./seed-files";

// ---------------------------------------------------------------------------
// Fixed ids. The version nibble is 7 so they sort like real ids.
// ---------------------------------------------------------------------------

/** Every id the seed owns starts with this. The wipe deletes by it. */
export const SEED_ID_PREFIX = "0190a000-0000-7000-8000-";

const fixedId = (block: number, n: number): string =>
  `${SEED_ID_PREFIX}${block.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;

/** Apex Interactive Studio, the working agency. */
export const ORG = fixedId(1, 1);
/** The agency in its grace window. */
const PAST_DUE_ORG = fixedId(1, 2);
/** The agency a locked contact's walk needs (spec 0014, AC-16): `canceled`, not time dependent like the grace org above. */
const LOCKED_ORG = fixedId(1, 3);
const USER = {
  sarah: fixedId(2, 1),
  amara: fixedId(2, 2),
  diego: fixedId(2, 3),
  priya: fixedId(2, 4),
  daniel: fixedId(2, 5),
  marcus: fixedId(2, 6),
  pastDueAdmin: fixedId(2, 7),
  lockedAdmin: fixedId(2, 8),
};
const MEMBERSHIP = {
  sarah: fixedId(3, 1),
  amara: fixedId(3, 2),
  diego: fixedId(3, 3),
  pastDueAdmin: fixedId(3, 4),
  lockedAdmin: fixedId(3, 5),
};
const SUBSCRIPTION = fixedId(4, 1);
const PAST_DUE_SUBSCRIPTION = fixedId(4, 2);
const LOCKED_SUBSCRIPTION = fixedId(4, 3);
export const CLIENT = {
  northstar: fixedId(5, 1),
  harborLane: fixedId(5, 2),
  /** Fernwood Clinic, under the grace agency (spec 0014). */
  fernwood: fixedId(5, 3),
  /** Cinder Media, under the locked agency below (spec 0014, AC-16). */
  cinder: fixedId(5, 4),
};
const CONTACT = {
  priyaNorthstar: fixedId(6, 1),
  daniel: fixedId(6, 2),
  graceInvited: fixedId(6, 3),
  marcus: fixedId(6, 4),
  priyaHarbor: fixedId(6, 5),
  priyaFernwood: fixedId(6, 6),
  priyaCinder: fixedId(6, 7),
};
export const PROJECT = {
  designSystem: fixedId(7, 1),
  mobileApp: fixedId(7, 2),
  onboarding: fixedId(7, 3),
};
const DELIVERABLE = {
  executiveSummary: fixedId(8, 1),
  releaseNotes: fixedId(8, 2),
  qaLog: fixedId(8, 3),
  designTokens: fixedId(8, 4),
  architectureDiagram: fixedId(8, 5),
  riskRegister: fixedId(8, 6),
  storybookWalkthrough: fixedId(8, 7),
  wireframes: fixedId(8, 8),
  copyDeck: fixedId(8, 9),
  usabilityFindings: fixedId(8, 10),
};
export const INVOICE = {
  paid: fixedId(9, 1),
  sent: fixedId(9, 2),
  overdue: fixedId(9, 3),
  draft: fixedId(9, 4),
};
const lineId = (invoice: number, position: number): string =>
  fixedId(10, invoice * 100 + position);
const eventId = (invoice: number, n: number): string =>
  fixedId(11, invoice * 100 + n);

// ---------------------------------------------------------------------------
// Time. Everything is relative to the run, so the data is always recent.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Midnight UTC today. */
const midnight = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** `days` before today, at `hour:minute` UTC. Always in the past for `days >= 1`. */
const ago = (now: Date, days: number, hour = 9, minute = 0): Date =>
  new Date(midnight(now) - days * DAY_MS + (hour * 60 + minute) * MINUTE_MS);

/** `seconds` after `moment`: a notification lands moments after the move that caused it. */
const after = (moment: Date, seconds: number): Date =>
  new Date(moment.getTime() + seconds * 1000);

/** A calendar day, `days` from today (negative for the past), as `YYYY-MM-DD`. */
const day = (now: Date, days: number): string =>
  new Date(midnight(now) + days * DAY_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Where Apex lives
// ---------------------------------------------------------------------------

/**
 * Which organization Apex's business data goes under, and which user owns it.
 *
 * By default that is the seed's own organization and Sarah Chen. Bound to a
 * real Clerk organization (`SEED_CLERK_ORG_ID`), it is that organization's own
 * local row and its real admin instead: the seed keeps both, and the real
 * admin stands in for Sarah as the person who issued the invoices and
 * uploaded the files.
 */
export type Placement = {
  readonly orgId: string;
  readonly ownerId: string;
  /** Bound: the organization, its admin and its real subscription already exist. */
  readonly bound: boolean;
  /** Bound, and the organization has no subscription row of its own yet. */
  readonly needsSubscription: boolean;
};

export const SEEDED_PLACEMENT: Placement = {
  orgId: ORG,
  ownerId: USER.sarah,
  bound: false,
  needsSubscription: true,
};

// ---------------------------------------------------------------------------
// The dataset, as plain data
// ---------------------------------------------------------------------------

type LineInput = {
  readonly description: string;
  /** Hours, as the decimal string the database stores. */
  readonly hours: string;
  /** Whole dollars per hour. */
  readonly hourlyRate: number;
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
  readonly notes?: string;
  readonly createdAt: Date;
  readonly lines: readonly LineInput[];
};

/** Nothing in these invoices is taxed: B2B services, billed hourly. */
const TAX_RATE_BP = 0;

/** Build one invoice and its line items with totals that satisfy the CHECKs. */
function buildInvoice(
  input: InvoiceInput,
  orgId: string,
): {
  readonly invoice: typeof schema.invoices.$inferInsert;
  readonly lineItems: readonly (typeof schema.invoiceLineItems.$inferInsert)[];
} {
  const lineItems = input.lines.map((line, index) => ({
    id: lineId(input.index, index + 1),
    orgId,
    invoiceId: input.id,
    description: line.description,
    quantity: line.hours,
    unitAmountCents: line.hourlyRate * 100,
    amountCents: lineAmountCents(line.hours, line.hourlyRate * 100),
    position: index + 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }));

  const totals = invoiceTotals(
    lineItems.map((line) => line.amountCents),
    TAX_RATE_BP,
  );

  return {
    invoice: {
      id: input.id,
      orgId,
      clientId: input.clientId,
      number: input.number,
      status: input.status,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: "USD",
      taxRateBp: TAX_RATE_BP,
      paidAt: input.paidAt,
      notes: input.notes,
      createdAt: input.createdAt,
      updatedAt: input.paidAt ?? input.createdAt,
      ...totals,
    },
    lineItems,
  };
}

const PAYMENT_TERMS =
  "Net 15. Pay by ACH to the account on your engagement letter and quote the invoice number. Thank you for your business.";

function invoiceInputs(now: Date): readonly InvoiceInput[] {
  return [
    // $6,500.00. Drafted, issued, then paid two days early.
    {
      id: INVOICE.paid,
      index: 1,
      clientId: CLIENT.northstar,
      status: "paid",
      number: 1,
      issueDate: day(now, -46),
      dueDate: day(now, -31),
      paidAt: ago(now, 33, 14, 5),
      notes: PAYMENT_TERMS,
      createdAt: ago(now, 48, 15, 20),
      lines: [
        {
          description: "React Native architecture and API integration",
          hours: "35",
          hourlyRate: 120,
        },
        {
          description: "UI/UX design, mobile flows and prototypes",
          hours: "23",
          hourlyRate: 100,
        },
      ],
    },
    // $3,850.00. Issued 5 days ago, due in 10.
    {
      id: INVOICE.sent,
      index: 2,
      clientId: CLIENT.northstar,
      status: "sent",
      number: 2,
      issueDate: day(now, -5),
      dueDate: day(now, 10),
      notes: PAYMENT_TERMS,
      createdAt: ago(now, 7, 16, 40),
      lines: [
        {
          description:
            "Design token architecture and Style Dictionary pipeline",
          hours: "22",
          hourlyRate: 125,
        },
        {
          description: "Component audit and migration plan",
          hours: "10",
          hourlyRate: 110,
        },
      ],
    },
    // $1,200.00. Due four days ago, so the nightly sweep has marked it overdue.
    {
      id: INVOICE.overdue,
      index: 3,
      clientId: CLIENT.harborLane,
      status: "overdue",
      number: 3,
      issueDate: day(now, -19),
      dueDate: day(now, -4),
      notes: PAYMENT_TERMS,
      createdAt: ago(now, 21, 11, 15),
      lines: [
        {
          description: "Stakeholder discovery workshops",
          hours: "4",
          hourlyRate: 150,
        },
        {
          description: "User journey mapping and KYC flow audit",
          hours: "4",
          hourlyRate: 150,
        },
      ],
    },
    // $4,200.00. Not issued, so it has no number and no dates, and the portal
    // never lists it.
    {
      id: INVOICE.draft,
      index: 4,
      clientId: CLIENT.northstar,
      status: "draft",
      createdAt: ago(now, 1, 17, 30),
      lines: [
        {
          description: "Component library build in React and Storybook",
          hours: "20",
          hourlyRate: 120,
        },
        {
          description: "Accessibility audit and WCAG 2.2 AA remediation",
          hours: "12",
          hourlyRate: 150,
        },
      ],
    },
  ];
}

/**
 * What happened to each issued invoice, in order (spec 0012, AC-18). A draft
 * has no history yet, which is the honest history of a draft: its "created"
 * moment is the invoice's own `created_at`, not an event. The nightly sweep
 * writes `overdue` with no actor, at 03:00 UTC the day after the due date.
 */
function invoiceEvents(
  now: Date,
  who: Placement,
): readonly (typeof schema.invoiceEvents.$inferInsert)[] {
  return [
    // INV-0001, Northstar: issued, notified, paid two days early.
    {
      id: eventId(1, 1),
      orgId: who.orgId,
      invoiceId: INVOICE.paid,
      kind: "issued",
      fromStatus: "draft",
      toStatus: "sent",
      actorUserId: who.ownerId,
      createdAt: ago(now, 46, 9, 12),
    },
    {
      id: eventId(1, 2),
      orgId: who.orgId,
      invoiceId: INVOICE.paid,
      kind: "notified",
      actorUserId: who.ownerId,
      note: "delivered: daniel.okafor@northstarcloud.example",
      createdAt: after(ago(now, 46, 9, 12), 4),
    },
    {
      id: eventId(1, 3),
      orgId: who.orgId,
      invoiceId: INVOICE.paid,
      kind: "paid",
      fromStatus: "sent",
      toStatus: "paid",
      actorUserId: who.ownerId,
      createdAt: ago(now, 33, 14, 5),
    },
    // INV-0002, Northstar: issued 5 days ago and still open.
    {
      id: eventId(2, 1),
      orgId: who.orgId,
      invoiceId: INVOICE.sent,
      kind: "issued",
      fromStatus: "draft",
      toStatus: "sent",
      actorUserId: who.ownerId,
      createdAt: ago(now, 5, 10, 30),
    },
    {
      id: eventId(2, 2),
      orgId: who.orgId,
      invoiceId: INVOICE.sent,
      kind: "notified",
      actorUserId: who.ownerId,
      note: "delivered: priya.patel@northstarcloud.example, daniel.okafor@northstarcloud.example",
      createdAt: after(ago(now, 5, 10, 30), 3),
    },
    // INV-0003, Harbor Lane Capital: the first delivery failed, a retry
    // landed, then the sweep marked it overdue.
    {
      id: eventId(3, 1),
      orgId: who.orgId,
      invoiceId: INVOICE.overdue,
      kind: "issued",
      fromStatus: "draft",
      toStatus: "sent",
      actorUserId: who.ownerId,
      createdAt: ago(now, 19, 16, 45),
    },
    {
      id: eventId(3, 2),
      orgId: who.orgId,
      invoiceId: INVOICE.overdue,
      kind: "notification_failed",
      actorUserId: who.ownerId,
      note: "failed: marcus.lindqvist@harborlanecapital.example (temporary mailbox error), priya.patel@harborlanecapital.example (temporary mailbox error)",
      createdAt: after(ago(now, 19, 16, 45), 5),
    },
    {
      id: eventId(3, 3),
      orgId: who.orgId,
      invoiceId: INVOICE.overdue,
      kind: "notified",
      actorUserId: who.ownerId,
      note: "delivered: marcus.lindqvist@harborlanecapital.example, priya.patel@harborlanecapital.example",
      createdAt: ago(now, 19, 17, 2),
    },
    {
      id: eventId(3, 4),
      orgId: who.orgId,
      invoiceId: INVOICE.overdue,
      kind: "overdue",
      fromStatus: "sent",
      toStatus: "overdue",
      createdAt: ago(now, 3, 3, 0),
    },
  ];
}

type SeedFile = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly uploadedBy: string;
  readonly visibleToClient: boolean;
  readonly status: schema.DeliverableStatus;
  readonly createdAt: Date;
};

function deliverableInputs(now: Date, who: Placement): readonly SeedFile[] {
  return [
    // Q3 Mobile App Overhaul, delivered.
    {
      id: DELIVERABLE.executiveSummary,
      projectId: PROJECT.mobileApp,
      name: "executive-summary.pdf",
      uploadedBy: who.ownerId,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 23, 15, 10),
    },
    {
      id: DELIVERABLE.releaseNotes,
      projectId: PROJECT.mobileApp,
      name: "mobile-release-notes-q3.md",
      uploadedBy: USER.diego,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 24, 13, 45),
    },
    {
      id: DELIVERABLE.qaLog,
      projectId: PROJECT.mobileApp,
      name: "internal-qa-regression-log.md",
      uploadedBy: USER.diego,
      visibleToClient: false,
      status: "ready",
      createdAt: ago(now, 26, 10, 5),
    },
    // Design System v2 Migration, in progress.
    {
      id: DELIVERABLE.designTokens,
      projectId: PROJECT.designSystem,
      name: "design-tokens-v2.1.json",
      uploadedBy: USER.amara,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 6, 14, 20),
    },
    {
      id: DELIVERABLE.architectureDiagram,
      projectId: PROJECT.designSystem,
      name: "architecture-diagram.png",
      uploadedBy: USER.diego,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 12, 11, 30),
    },
    {
      id: DELIVERABLE.riskRegister,
      projectId: PROJECT.designSystem,
      name: "component-migration-risk-register.md",
      uploadedBy: USER.diego,
      visibleToClient: false,
      status: "ready",
      createdAt: ago(now, 9, 16, 0),
    },
    // Still uploading: a pending row is never listed, downloadable or shown to
    // the client. Twenty minutes old, inside the abandoned upload sweep's
    // 24 hour window, so the sweep leaves it alone.
    {
      id: DELIVERABLE.storybookWalkthrough,
      projectId: PROJECT.designSystem,
      name: "storybook-walkthrough.mp4",
      uploadedBy: USER.amara,
      visibleToClient: true,
      status: "pending",
      createdAt: new Date(now.getTime() - 20 * MINUTE_MS),
    },
    // Client Onboarding Flow Redesign, in review.
    {
      id: DELIVERABLE.wireframes,
      projectId: PROJECT.onboarding,
      name: "onboarding-flow-wireframes.pdf",
      uploadedBy: USER.amara,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 8, 12, 15),
    },
    {
      id: DELIVERABLE.copyDeck,
      projectId: PROJECT.onboarding,
      name: "kyc-copy-deck.md",
      uploadedBy: who.ownerId,
      visibleToClient: true,
      status: "ready",
      createdAt: ago(now, 5, 9, 50),
    },
    {
      id: DELIVERABLE.usabilityFindings,
      projectId: PROJECT.onboarding,
      name: "usability-test-findings-internal.md",
      uploadedBy: USER.amara,
      visibleToClient: false,
      status: "ready",
      createdAt: ago(now, 3, 15, 35),
    },
  ];
}

/** The object key a deliverable lives at. Never built from its name. */
export const objectKey = (
  orgId: string,
  projectId: string,
  deliverableId: string,
): string => `org/${orgId}/project/${projectId}/${deliverableId}`;

/** A file the seed will put in storage: where, what, and the real bytes. */
export type SeedObject = {
  readonly key: string;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

export type DatasetInput = {
  readonly now: Date;
  /** The Clerk user id Priya Patel's rows bind to. */
  readonly priyaClerkUserId: string;
  /** Where Apex lives. Omitted, it is the seed's own organization. */
  readonly placement?: Placement;
};

export function buildDataset({
  now,
  priyaClerkUserId,
  placement: who = SEEDED_PLACEMENT,
}: DatasetInput) {
  const built = invoiceInputs(now).map((input) =>
    buildInvoice(input, who.orgId),
  );

  const files = deliverableInputs(now, who).map((file) => {
    const bytes = mockFileBytes(file.name);

    return { file, bytes, key: objectKey(who.orgId, file.projectId, file.id) };
  });

  const objects: readonly SeedObject[] = files
    .filter(({ file }) => file.status === "ready")
    .map(({ file, bytes, key }) => ({
      key,
      name: file.name,
      contentType: contentTypeFor(file.name),
      bytes,
    }));

  /** What `/settings` shows. Applied in place when Apex is bound to a real organization. */
  const apexProfile = {
    name: "Apex Interactive Studio",
    slug: "apex-interactive-studio",
    description: "Digital product and engineering agency.",
    taxId: "US-9482019",
    addressLine1: "500 Howard Street",
    addressLine2: "Floor 6",
    city: "San Francisco",
    region: "CA",
    postalCode: "94105",
    country: "United States",
    // Three invoices have been issued, so the next one takes 4.
    nextInvoiceNumber: 4,
    defaultCurrency: "USD",
  } satisfies Partial<typeof schema.organizations.$inferInsert>;

  return {
    apexProfile,

    // Bound, the organization already exists and keeps its own id, Clerk id
    // and creation date, so only the profile above is written to it.
    organizations: [
      ...(who.bound
        ? []
        : [
            {
              id: who.orgId,
              clerkOrgId: "org_seed_apex_interactive_studio",
              ...apexProfile,
              createdAt: ago(now, 59, 8, 30),
              updatedAt: ago(now, 59, 8, 30),
            },
          ]),
      {
        id: PAST_DUE_ORG,
        clerkOrgId: "org_seed_harbor_lane",
        name: "Harbor Lane",
        slug: "harbor-lane",
        defaultCurrency: "USD",
        createdAt: ago(now, 59, 9, 0),
        updatedAt: ago(now, 59, 9, 0),
      },
      {
        id: LOCKED_ORG,
        clerkOrgId: "org_seed_anchor_ridge",
        name: "Anchor Ridge",
        slug: "anchor-ridge",
        defaultCurrency: "USD",
        createdAt: ago(now, 59, 9, 30),
        updatedAt: ago(now, 59, 9, 30),
      },
    ] satisfies (typeof schema.organizations.$inferInsert)[],

    users: [
      // Bound, the owner is the organization's own admin, already mirrored.
      ...(who.bound
        ? []
        : [
            {
              id: USER.sarah,
              clerkUserId: "user_seed_sarah_chen",
              email: "sarah.chen@apexinteractive.example",
              name: "Sarah Chen",
              createdAt: ago(now, 59, 8, 30),
              updatedAt: ago(now, 59, 8, 30),
            },
          ]),
      {
        id: USER.amara,
        clerkUserId: "user_seed_amara_osei",
        email: "amara.osei@apexinteractive.example",
        name: "Amara Osei",
        createdAt: ago(now, 52, 10, 0),
        updatedAt: ago(now, 52, 10, 0),
      },
      {
        id: USER.diego,
        clerkUserId: "user_seed_diego_ramirez",
        email: "diego.ramirez@apexinteractive.example",
        name: "Diego Ramirez",
        createdAt: ago(now, 45, 14, 15),
        updatedAt: ago(now, 45, 14, 15),
      },
      {
        id: USER.priya,
        clerkUserId: priyaClerkUserId,
        email: "priya.patel@northstarcloud.example",
        name: "Priya Patel",
        // Her first acceptance, at Cinder Media below.
        createdAt: ago(now, 48, 16, 0),
        updatedAt: ago(now, 48, 16, 0),
      },
      {
        id: USER.daniel,
        clerkUserId: "user_seed_daniel_okafor",
        email: "daniel.okafor@northstarcloud.example",
        name: "Daniel Okafor",
        createdAt: ago(now, 55, 15, 30),
        updatedAt: ago(now, 55, 15, 30),
      },
      {
        id: USER.marcus,
        clerkUserId: "user_seed_marcus_lindqvist",
        email: "marcus.lindqvist@harborlanecapital.example",
        name: "Marcus Lindqvist",
        createdAt: ago(now, 27, 9, 40),
        updatedAt: ago(now, 27, 9, 40),
      },
      {
        id: USER.pastDueAdmin,
        clerkUserId: "user_seed_harbor_admin",
        email: "dana.reyes@harbor-lane.example",
        name: "Dana Reyes",
        createdAt: ago(now, 59, 9, 0),
        updatedAt: ago(now, 59, 9, 0),
      },
      {
        id: USER.lockedAdmin,
        clerkUserId: "user_seed_locked_admin",
        email: "morgan.blake@anchor-ridge.example",
        name: "Morgan Blake",
        createdAt: ago(now, 59, 9, 30),
        updatedAt: ago(now, 59, 9, 30),
      },
    ] satisfies (typeof schema.users.$inferInsert)[],

    memberships: [
      ...(who.bound
        ? []
        : [
            {
              id: MEMBERSHIP.sarah,
              orgId: who.orgId,
              userId: USER.sarah,
              role: "admin" as const,
              createdAt: ago(now, 59, 8, 30),
              updatedAt: ago(now, 59, 8, 30),
            },
          ]),
      {
        id: MEMBERSHIP.amara,
        orgId: who.orgId,
        userId: USER.amara,
        role: "member",
        createdAt: ago(now, 52, 10, 0),
        updatedAt: ago(now, 52, 10, 0),
      },
      {
        id: MEMBERSHIP.diego,
        orgId: who.orgId,
        userId: USER.diego,
        role: "member",
        createdAt: ago(now, 45, 14, 15),
        updatedAt: ago(now, 45, 14, 15),
      },
      {
        id: MEMBERSHIP.pastDueAdmin,
        orgId: PAST_DUE_ORG,
        userId: USER.pastDueAdmin,
        role: "admin",
        createdAt: ago(now, 59, 9, 0),
        updatedAt: ago(now, 59, 9, 0),
      },
      {
        id: MEMBERSHIP.lockedAdmin,
        orgId: LOCKED_ORG,
        userId: USER.lockedAdmin,
        role: "admin",
        createdAt: ago(now, 59, 9, 30),
        updatedAt: ago(now, 59, 9, 30),
      },
    ] satisfies (typeof schema.memberships.$inferInsert)[],

    subscriptions: [
      // Bound, a real organization keeps the subscription Stripe gave it.
      ...(who.needsSubscription
        ? [
            {
              id: SUBSCRIPTION,
              orgId: who.orgId,
              stripeCustomerId: "cus_seed_apex_interactive",
              stripeSubscriptionId: "sub_seed_apex_interactive",
              stripePriceId: "price_seed_monthly",
              status: "active",
              // A monthly plan that renewed 18 days ago, so it renews in 12.
              currentPeriodEnd: new Date(midnight(now) + 12 * DAY_MS),
              cancelAtPeriodEnd: false,
              createdAt: ago(now, 59, 8, 45),
              updatedAt: ago(now, 18, 0, 5),
            },
          ]
        : []),
      {
        id: PAST_DUE_SUBSCRIPTION,
        orgId: PAST_DUE_ORG,
        stripeCustomerId: "cus_seed_harbor_lane",
        stripeSubscriptionId: "sub_seed_harbor_lane",
        stripePriceId: "price_seed_monthly",
        status: "past_due",
        currentPeriodEnd: new Date(midnight(now) + 12 * DAY_MS),
        cancelAtPeriodEnd: false,
        // Relative to the seed, so the window is open now and lapses on its
        // own in a week: `grace` today, `locked` after 7 days, no job needed.
        pastDueSince: new Date(now.getTime() - 60 * MINUTE_MS),
        createdAt: ago(now, 59, 9, 5),
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
        currentPeriodEnd: new Date(midnight(now) - 10 * DAY_MS),
        cancelAtPeriodEnd: false,
        createdAt: ago(now, 59, 9, 35),
      },
    ] satisfies (typeof schema.subscriptions.$inferInsert)[],

    clients: [
      {
        id: CLIENT.northstar,
        orgId: who.orgId,
        name: "Northstar Cloud Solutions",
        companyEmail: "hello@northstarcloud.example",
        phone: "+1 415 555 0142",
        industry: "Technology, enterprise SaaS",
        notes:
          "Enterprise account. Quarterly business review with the VP Product; invoices go to accounts payable.",
        billingAddressLine1: "1200 Market Street",
        billingAddressLine2: "Suite 900",
        billingCity: "San Francisco",
        billingRegion: "CA",
        billingPostalCode: "94102",
        billingCountry: "United States",
        createdAt: ago(now, 58, 11, 0),
        updatedAt: ago(now, 30, 9, 0),
      },
      {
        id: CLIENT.harborLane,
        orgId: who.orgId,
        name: "Harbor Lane Capital",
        companyEmail: "hello@harborlanecapital.example",
        phone: "+1 212 555 0187",
        industry: "Financial technology",
        notes:
          "Regulated. Every customer facing screen goes through compliance.",
        billingAddressLine1: "88 Pine Street",
        billingAddressLine2: "14th Floor",
        billingCity: "New York",
        billingRegion: "NY",
        billingPostalCode: "10005",
        billingCountry: "United States",
        createdAt: ago(now, 31, 10, 30),
        updatedAt: ago(now, 31, 10, 30),
      },
      {
        id: CLIENT.fernwood,
        orgId: PAST_DUE_ORG,
        name: "Fernwood Clinic",
        companyEmail: "hello@fernwood-clinic.example",
        createdAt: ago(now, 55, 10, 0),
        updatedAt: ago(now, 55, 10, 0),
      },
      {
        id: CLIENT.cinder,
        orgId: LOCKED_ORG,
        name: "Cinder Media",
        companyEmail: "hello@cinder-media.example",
        createdAt: ago(now, 55, 10, 30),
        updatedAt: ago(now, 55, 10, 30),
      },
    ] satisfies (typeof schema.clients.$inferInsert)[],

    clientContacts: [
      {
        // Priya joined Northstar last, six days ago, so this is her most
        // recently accepted row and the one the portal opens on with no
        // cookie (spec 0003, AC-5). The walk's "lands on the Northstar
        // overview" (spec 0014, AC-16) depends on that ordering.
        id: CONTACT.priyaNorthstar,
        orgId: who.orgId,
        clientId: CLIENT.northstar,
        userId: USER.priya,
        email: "priya.patel@northstarcloud.example",
        name: "Priya Patel",
        invitedByUserId: who.ownerId,
        invitedAt: ago(now, 7, 10, 0),
        acceptedAt: ago(now, 6, 13, 25),
        createdAt: ago(now, 7, 9, 55),
        updatedAt: ago(now, 6, 13, 25),
      },
      {
        id: CONTACT.daniel,
        orgId: who.orgId,
        clientId: CLIENT.northstar,
        userId: USER.daniel,
        email: "daniel.okafor@northstarcloud.example",
        name: "Daniel Okafor",
        invitedByUserId: who.ownerId,
        invitedAt: ago(now, 56, 10, 0),
        acceptedAt: ago(now, 55, 15, 30),
        createdAt: ago(now, 56, 9, 55),
        updatedAt: ago(now, 55, 15, 30),
      },
      {
        id: CONTACT.graceInvited,
        orgId: who.orgId,
        clientId: CLIENT.northstar,
        email: "grace.whitfield@northstarcloud.example",
        name: "Grace Whitfield",
        invitedByUserId: who.ownerId,
        // A hash shaped placeholder. No real token corresponds to it.
        inviteTokenHash:
          "9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
        inviteExpiresAt: new Date(now.getTime() + 4 * DAY_MS),
        invitedAt: ago(now, 3, 10, 15),
        createdAt: ago(now, 3, 10, 10),
        updatedAt: ago(now, 3, 10, 15),
      },
      {
        id: CONTACT.marcus,
        orgId: who.orgId,
        clientId: CLIENT.harborLane,
        userId: USER.marcus,
        email: "marcus.lindqvist@harborlanecapital.example",
        name: "Marcus Lindqvist",
        invitedByUserId: who.ownerId,
        invitedAt: ago(now, 28, 10, 0),
        acceptedAt: ago(now, 27, 9, 40),
        createdAt: ago(now, 28, 9, 55),
        updatedAt: ago(now, 27, 9, 40),
      },
      {
        id: CONTACT.priyaHarbor,
        orgId: who.orgId,
        clientId: CLIENT.harborLane,
        userId: USER.priya,
        email: "priya.patel@harborlanecapital.example",
        name: "Priya Patel",
        invitedByUserId: who.ownerId,
        // Accepted before the Northstar row above, on purpose: see the note there.
        invitedAt: ago(now, 27, 14, 0),
        acceptedAt: ago(now, 26, 11, 10),
        createdAt: ago(now, 27, 13, 55),
        updatedAt: ago(now, 26, 11, 10),
      },
      {
        id: CONTACT.priyaFernwood,
        orgId: PAST_DUE_ORG,
        clientId: CLIENT.fernwood,
        userId: USER.priya,
        email: "priya.patel@fernwood-clinic.example",
        name: "Priya Patel",
        invitedAt: ago(now, 40, 10, 0),
        acceptedAt: ago(now, 40, 16, 0),
        createdAt: ago(now, 40, 9, 55),
        updatedAt: ago(now, 40, 16, 0),
      },
      {
        id: CONTACT.priyaCinder,
        orgId: LOCKED_ORG,
        clientId: CLIENT.cinder,
        userId: USER.priya,
        email: "priya.patel@cinder-media.example",
        name: "Priya Patel",
        invitedAt: ago(now, 48, 10, 0),
        acceptedAt: ago(now, 48, 16, 0),
        createdAt: ago(now, 48, 9, 55),
        updatedAt: ago(now, 48, 16, 0),
      },
    ] satisfies (typeof schema.clientContacts.$inferInsert)[],

    projects: [
      {
        id: PROJECT.mobileApp,
        orgId: who.orgId,
        clientId: CLIENT.northstar,
        name: "Q3 Mobile App Overhaul",
        description:
          "Rebuilt iOS and Android app on React Native, with biometric sign in and offline mode.",
        status: "delivered",
        dueDate: day(now, -22),
        createdAt: ago(now, 57, 10, 0),
        updatedAt: ago(now, 21, 16, 30),
      },
      {
        id: PROJECT.designSystem,
        orgId: who.orgId,
        clientId: CLIENT.northstar,
        name: "Design System v2 Migration",
        description:
          "Move the product suite to a shared token driven component library, one surface at a time.",
        status: "in_progress",
        dueDate: day(now, 24),
        createdAt: ago(now, 38, 10, 15),
        updatedAt: ago(now, 2, 11, 45),
      },
      {
        id: PROJECT.onboarding,
        orgId: who.orgId,
        clientId: CLIENT.harborLane,
        name: "Client Onboarding Flow Redesign",
        description:
          "A shorter, compliant sign up and identity check flow, from firm details to bank connection.",
        status: "in_review",
        dueDate: day(now, 9),
        createdAt: ago(now, 26, 13, 0),
        updatedAt: ago(now, 1, 15, 10),
      },
    ] satisfies (typeof schema.projects.$inferInsert)[],

    deliverables: files.map(({ file, bytes, key }) => ({
      id: file.id,
      orgId: who.orgId,
      projectId: file.projectId,
      name: file.name,
      r2Key: key,
      contentType: contentTypeFor(file.name),
      // A pending upload has no confirmed object behind it, so no size yet.
      sizeBytes: file.status === "ready" ? bytes.length : 0,
      uploadedByUserId: file.uploadedBy,
      visibleToClient: file.visibleToClient,
      status: file.status,
      createdAt: file.createdAt,
      updatedAt: file.createdAt,
    })) satisfies (typeof schema.deliverables.$inferInsert)[],

    invoices: built.map((entry) => entry.invoice),
    invoiceLineItems: built.flatMap((entry) => entry.lineItems),
    invoiceEvents: invoiceEvents(now, who),
    objects,
  };
}
