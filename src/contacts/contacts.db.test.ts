/**
 * @vitest-environment node
 *
 * covers: spec 0009 AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10,
 * AC-11, AC-12, AC-13, AC-15
 *
 * The five staff actions and the acceptance door against real PostgreSQL. The
 * actions run through the real `withTenantAction()` with the session module
 * stubbed to say who is asking, the pooled executor pointed at a transaction
 * that is rolled back after every case, and the email transport replaced by a
 * spy so a send can be made to succeed or fail on demand.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  memberships,
  organizations,
  subscriptions,
  users,
} from "@/db/schema";
import type { MirrorUser, TransactionExecutor } from "@/db/tenant";
import { ok, failure } from "@/db/tenant/errors";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import type { EmailMessage } from "@/email/send";

const state = vi.hoisted(() => ({
  tx: undefined as unknown,
  claims: {
    clerkUserId: undefined as string | undefined,
    clerkOrgId: undefined as string | undefined,
    clerkOrgRole: undefined as string | undefined,
  },
  cookie: undefined as string | undefined,
  /** What the next `sendEmail` calls answer, in order; `ok` when empty. */
  emailOutcomes: [] as ("ok" | "fail")[],
  sent: [] as EmailMessage[],
  /** What Clerk says about the signed in user, for the accept action. */
  clerk: {
    user: undefined as unknown,
    emails: [] as string[],
  },
  /** The cookie jar the accept action writes into. */
  jar: new Map<string, { value: string; options: unknown }>(),
}));

vi.mock("@/db/tenant/executor", () => ({
  pooledDb: async () => state.tx,
}));

vi.mock("@/db/tenant/session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => state.claims,
  contactCookie: async () => state.cookie,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  updateTag: () => undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) => {
      state.jar.set(name, { value, options });
    },
    get: (name: string) => state.jar.get(name),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${to}`,
    });
  },
}));

vi.mock("@/auth/clerk", () => ({
  clerkUser: async () =>
    state.clerk.user === undefined
      ? failure({ code: "not_found", message: "" })
      : ok(state.clerk.user),
  clerkVerifiedEmails: async () => ok(state.clerk.emails),
}));

vi.mock("@/email/send", () => ({
  sendEmail: async (message: EmailMessage) => {
    state.sent.push(message);
    const outcome = state.emailOutcomes.shift() ?? "ok";

    return outcome === "ok"
      ? ok({ id: `sent-${state.sent.length}` })
      : failure({ code: "unavailable", message: "provider said no" });
  },
}));

const { addContact } = await import("./add-contact");
const { sendInvitation } = await import("./send-invitation");
const { updateContact } = await import("./update-contact");
const { revokeInvitation } = await import("./revoke-invitation");
const { removeContact } = await import("./remove-contact");
const { inspectInvitation, acceptInvitation } =
  await import("@/db/tenant/invitation");
const { acceptInvitation: acceptAction } = await import("./accept-invitation");
const { render } = await import("@react-email/render");
const { hashToken, parseToken } = await import("./token");
const { contactStatus } = await import("./status");

loadEnvFiles();

// Every case is a dozen round trips to a remote database; the default five
// seconds is for unit tests.
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Fixture = {
  readonly orgA: string;
  readonly orgB: string;
  readonly clerkOrgA: string;
  readonly staffA: string;
  readonly clerkStaffA: string;
  readonly staffB: string;
  readonly clerkStaffB: string;
  readonly clerkOrgB: string;
  readonly subscriptionA: string;
  readonly clientA1: string;
  readonly clientA2: string;
  readonly clientArchived: string;
  readonly clientB1: string;
  /** A not invited contact of A1. */
  readonly contactA1: string;
  readonly contactA1Email: string;
  /** An accepted contact of A1, bound to `portalUser`. */
  readonly contactAccepted: string;
  readonly portalUser: string;
  readonly clerkPortalUser: string;
  readonly contactB1: string;
  readonly tag: string;
};

async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId();
  const ids = {
    orgA: newId(),
    orgB: newId(),
    staffA: newId(),
    staffB: newId(),
    subscriptionA: newId(),
    clientA1: newId(),
    clientA2: newId(),
    clientArchived: newId(),
    clientB1: newId(),
    contactA1: newId(),
    contactAccepted: newId(),
    portalUser: newId(),
    contactB1: newId(),
  };

  await tx.insert(organizations).values([
    {
      id: ids.orgA,
      clerkOrgId: `org_${tag}_a`,
      name: "Agency A",
      slug: `a-${tag}`,
    },
    {
      id: ids.orgB,
      clerkOrgId: `org_${tag}_b`,
      name: "Agency B",
      slug: `b-${tag}`,
    },
  ]);

  await tx.insert(users).values([
    {
      id: ids.staffA,
      clerkUserId: `user_${tag}_a`,
      email: `staff-a-${tag}@example.test`,
      name: "Staff A",
    },
    {
      id: ids.staffB,
      clerkUserId: `user_${tag}_b`,
      email: `staff-b-${tag}@example.test`,
      name: "Staff B",
    },
    {
      id: ids.portalUser,
      clerkUserId: `user_${tag}_p`,
      email: `portal-${tag}@example.test`,
      name: "Portal",
    },
  ]);

  await tx.insert(memberships).values([
    { id: newId(), orgId: ids.orgA, userId: ids.staffA, role: "admin" },
    { id: newId(), orgId: ids.orgB, userId: ids.staffB, role: "member" },
  ]);

  await tx.insert(subscriptions).values([
    {
      id: ids.subscriptionA,
      orgId: ids.orgA,
      stripeCustomerId: `cus_${tag}_a`,
      status: "active",
    },
    {
      id: newId(),
      orgId: ids.orgB,
      stripeCustomerId: `cus_${tag}_b`,
      status: "active",
    },
  ]);

  await tx.insert(clients).values([
    { id: ids.clientA1, orgId: ids.orgA, name: "Client A1" },
    { id: ids.clientA2, orgId: ids.orgA, name: "Client A2" },
    {
      id: ids.clientArchived,
      orgId: ids.orgA,
      name: "Archived",
      archivedAt: new Date(),
    },
    { id: ids.clientB1, orgId: ids.orgB, name: "Client B1" },
  ]);

  const contactA1Email = `ada-${tag}@example.test`;

  await tx.insert(clientContacts).values([
    {
      id: ids.contactA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      email: contactA1Email,
      name: "Ada",
    },
    {
      id: ids.contactAccepted,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      email: `portal-${tag}@example.test`,
      name: "Accepted",
      userId: ids.portalUser,
      acceptedAt: new Date(Date.now() - DAY),
      invitedAt: new Date(Date.now() - 2 * DAY),
      invitedByUserId: ids.staffA,
    },
    {
      id: ids.contactB1,
      orgId: ids.orgB,
      clientId: ids.clientB1,
      email: `b-${tag}@example.test`,
      name: "Bea",
    },
  ]);

  return {
    ...ids,
    clerkOrgA: `org_${tag}_a`,
    clerkOrgB: `org_${tag}_b`,
    clerkStaffA: `user_${tag}_a`,
    clerkStaffB: `user_${tag}_b`,
    clerkPortalUser: `user_${tag}_p`,
    contactA1Email,
    tag,
  };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      state.tx = tx;
      const fixture = await seed(tx);
      actAsStaff(fixture, "A");
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

function actAsStaff(fixture: Fixture, org: "A" | "B"): void {
  state.claims = {
    clerkUserId: org === "A" ? fixture.clerkStaffA : fixture.clerkStaffB,
    clerkOrgId: org === "A" ? fixture.clerkOrgA : fixture.clerkOrgB,
    clerkOrgRole: org === "A" ? "org:admin" : "org:member",
  };
}

/** Sign in as a brand new person for the accept action, with these verified emails. */
function actAsNewPerson(
  fixture: Fixture,
  verifiedEmails: readonly string[],
): string {
  const clerkUserId = `user_${fixture.tag}_fresh`;

  state.claims = {
    clerkUserId,
    clerkOrgId: undefined,
    clerkOrgRole: undefined,
  };
  state.clerk.user = mirrorOf(
    fixture,
    verifiedEmails[0] ?? "fresh@example.test",
    clerkUserId,
  );
  state.clerk.emails = [...verifiedEmails];

  return clerkUserId;
}

/** Run the accept Server Action, returning where it redirected or the Result. */
async function runAcceptAction(
  token: string,
): Promise<{ redirectedTo?: string; result?: unknown }> {
  try {
    return { result: await acceptAction({ token }) };
  } catch (thrown) {
    const digest = (thrown as { digest?: string }).digest ?? "";

    if (digest.startsWith("NEXT_REDIRECT")) {
      return { redirectedTo: digest.split(";")[2] };
    }

    throw thrown;
  }
}

function actAsContact(fixture: Fixture): void {
  state.claims = {
    clerkUserId: fixture.clerkPortalUser,
    clerkOrgId: undefined,
    clerkOrgRole: undefined,
  };
}

async function rowOf(tx: TransactionExecutor, id: string) {
  const [row] = await tx
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, id));

  return row;
}

/** The token from the last message the transport saw, as the email carries it. */
async function lastToken(): Promise<string> {
  const message = state.sent.at(-1);

  if (message === undefined) {
    throw new Error("no email was sent");
  }

  const text = await render(message.react, { plainText: true });
  const match = /token=([^\s&]+)/u.exec(text);

  if (match === null) {
    throw new Error("the email carried no token");
  }

  return decodeURIComponent(match[1]);
}

function identityFor(
  token: string,
  clerkUserId: string,
  verifiedEmails: readonly string[],
) {
  const parsed = parseToken(token);

  if (parsed === undefined) {
    throw new Error("malformed token in test");
  }

  return { token: parsed, clerkUserId, verifiedEmails };
}

function mirrorOf(
  fixture: Fixture,
  email: string,
  clerkUserId?: string,
): MirrorUser {
  return {
    clerkUserId: clerkUserId ?? `user_${fixture.tag}_new`,
    email,
    name: "New Person",
    imageUrl: undefined,
  };
}

const logged: string[] = [];

beforeEach(() => {
  state.sent.length = 0;
  state.emailOutcomes.length = 0;
  state.cookie = undefined;
  state.jar.clear();
  state.clerk.user = undefined;
  state.clerk.emails = [];
  logged.length = 0;
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    if (typeof line === "string") {
      logged.push(line);
    }
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.end();
});

/** The structured lines this feature wrote, parsed. */
function contactLines(): {
  operation: string;
  outcome: string;
  orgId?: string;
  contactId?: string;
}[] {
  return logged
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          event: string;
          operation: string;
          outcome: string;
          orgId?: string;
          contactId?: string;
        },
    )
    .filter((line) => line.event === "contacts.invitation");
}

describe.skipIf(url === undefined)(
  "client contacts against real PostgreSQL",
  () => {
    describe("addContact (AC-1)", () => {
      it("writes the row with org_id from the context and the email lowercased", async () => {
        await inRollback(async (tx, fixture) => {
          const result = await addContact({
            clientId: fixture.clientA1,
            name: "  Grace Hopper ",
            email: " Grace@Example.TEST ",
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const row = await rowOf(tx, result.data.id);
          expect(row?.orgId).toBe(fixture.orgA);
          expect(row?.clientId).toBe(fixture.clientA1);
          expect(row?.name).toBe("Grace Hopper");
          expect(row?.email).toBe("grace@example.test");
          expect(row?.userId).toBeNull();
          expect(row?.inviteTokenHash).toBeNull();
          expect(row?.invitedAt).toBeNull();
        });
      });

      it("refuses a duplicate email on the same client with a field error, and allows it on another client", async () => {
        await inRollback(async (_tx, fixture) => {
          const duplicate = await addContact({
            clientId: fixture.clientA1,
            name: "Ada again",
            email: fixture.contactA1Email.toUpperCase(),
          });

          expect(duplicate).toMatchObject({
            ok: false,
            error: {
              code: "conflict",
              fieldErrors: { email: expect.any(Array) },
            },
          });

          const elsewhere = await addContact({
            clientId: fixture.clientA2,
            name: "Ada elsewhere",
            email: fixture.contactA1Email,
          });

          expect(elsewhere.ok).toBe(true);
        });
      });

      it("refuses an archived client with conflict and a foreign client with not_found", async () => {
        await inRollback(async (_tx, fixture) => {
          const archived = await addContact({
            clientId: fixture.clientArchived,
            name: "X",
            email: "x@example.test",
          });
          expect(archived).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });

          const foreign = await addContact({
            clientId: fixture.clientB1,
            name: "X",
            email: "x@example.test",
          });
          expect(foreign).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });
    });

    describe("sendInvitation (AC-3, AC-5)", () => {
      it("stores only the digest, stamps the inviter, sends, then stamps invited_at", async () => {
        await inRollback(async (tx, fixture) => {
          const before = Date.now();
          const result = await sendInvitation({ contactId: fixture.contactA1 });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const row = await rowOf(tx, fixture.contactA1);
          const token = await lastToken();

          expect(row?.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/u);
          expect(row?.inviteTokenHash).toBe(hashToken(token));
          expect(row?.inviteTokenHash).not.toContain(token.split(".")[1]);
          expect(row?.invitedByUserId).toBe(fixture.staffA);
          expect(row?.invitedAt?.getTime()).toBeGreaterThanOrEqual(before);
          expect(row?.inviteExpiresAt?.getTime()).toBeGreaterThanOrEqual(
            before + 7 * DAY - MINUTE,
          );
          expect(result.data.expiresAt).toEqual(row?.inviteExpiresAt);
          expect(contactStatus(row!, new Date())).toBe("invited");

          const message = state.sent[0];
          expect(message.to).toBe(fixture.contactA1Email);
          expect(message.subject).toBe(
            "Agency A invited you to their client portal",
          );
          expect(message.from).toEqual({
            address: expect.stringContaining("@"),
            name: "Agency A via ClientHQ",
          });
          expect(message.replyTo).toBe(`staff-a-${fixture.tag}@example.test`);
          expect(message.idempotencyKey).toBe(
            `client-invitation/${fixture.contactA1}/${row?.inviteTokenHash?.slice(0, 12)}`,
          );
          expect(parseToken(token)?.contactId).toBe(fixture.contactA1);
        });
      });

      it("leaves invited_at untouched and the row unsent when the provider refuses, and the resend is not cooled down (AC-6)", async () => {
        await inRollback(async (tx, fixture) => {
          state.emailOutcomes.push("fail");

          const failed = await sendInvitation({ contactId: fixture.contactA1 });
          expect(failed).toMatchObject({
            ok: false,
            error: { code: "unavailable" },
          });

          const row = await rowOf(tx, fixture.contactA1);
          expect(row?.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/u);
          expect(row?.inviteExpiresAt).not.toBeNull();
          expect(row?.invitedAt).toBeNull();
          expect(contactStatus(row!, new Date())).toBe("unsent");

          const retried = await sendInvitation({
            contactId: fixture.contactA1,
          });
          expect(retried.ok).toBe(true);

          const after = await rowOf(tx, fixture.contactA1);
          expect(after?.invitedAt).not.toBeNull();
          expect(contactStatus(after!, new Date())).toBe("invited");
        });
      });

      it("a resend issues a new digest and the old link stops verifying (AC-3, AC-11)", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const first = await lastToken();

          await tx
            .update(clientContacts)
            .set({ invitedAt: new Date(Date.now() - 10 * MINUTE) })
            .where(eq(clientContacts.id, fixture.contactA1));

          const resent = await sendInvitation({ contactId: fixture.contactA1 });
          expect(resent.ok).toBe(true);
          const second = await lastToken();
          expect(second).not.toBe(first);

          const emails = [fixture.contactA1Email];
          expect(
            await inspectInvitation(identityFor(first, "user_x", emails)),
          ).toEqual({
            kind: "invalid",
            contactId: fixture.contactA1,
            orgId: fixture.orgA,
          });
          expect(
            await inspectInvitation(identityFor(second, "user_x", emails)),
          ).toMatchObject({ kind: "acceptable" });

          const snapshot = await rowOf(tx, fixture.contactA1);
          const refused = await acceptInvitation(
            identityFor(first, "user_x", emails),
            mirrorOf(fixture, fixture.contactA1Email),
          );
          expect(refused.kind).toBe("refused");
          expect(await rowOf(tx, fixture.contactA1)).toEqual(snapshot);
        });
      });

      it("refuses an accepted contact and an archived client with conflict", async () => {
        await inRollback(async (tx, fixture) => {
          expect(
            await sendInvitation({ contactId: fixture.contactAccepted }),
          ).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });

          const [archivedContact] = await tx
            .insert(clientContacts)
            .values({
              id: newId(),
              orgId: fixture.orgA,
              clientId: fixture.clientArchived,
              email: `arch-${fixture.tag}@example.test`,
              name: "Arch",
            })
            .returning({ id: clientContacts.id });

          expect(
            await sendInvitation({ contactId: archivedContact.id }),
          ).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });
          expect(state.sent).toHaveLength(0);
        });
      });
    });

    describe("the limits (AC-4)", () => {
      it("refuses a second send inside five minutes and allows one at exactly five", async () => {
        await inRollback(async (tx, fixture) => {
          expect(
            (await sendInvitation({ contactId: fixture.contactA1 })).ok,
          ).toBe(true);

          const again = await sendInvitation({ contactId: fixture.contactA1 });
          expect(again).toMatchObject({
            ok: false,
            error: { code: "rate_limited" },
          });
          expect(state.sent).toHaveLength(1);

          await tx
            .update(clientContacts)
            .set({ invitedAt: new Date(Date.now() - 5 * MINUTE - 1000) })
            .where(eq(clientContacts.id, fixture.contactA1));

          expect(
            (await sendInvitation({ contactId: fixture.contactA1 })).ok,
          ).toBe(true);
        });
      });

      it("refuses when fifty of the agency's contacts were invited inside the last day, counting only that agency", async () => {
        await inRollback(async (tx, fixture) => {
          const recent = (
            count: number,
            orgId: string,
            clientId: string,
            ageMs: number,
          ) =>
            Array.from({ length: count }, (_, i) => ({
              id: newId(),
              orgId,
              clientId,
              email: `bulk-${orgId}-${i}-${fixture.tag}@example.test`,
              name: `Bulk ${i}`,
              inviteTokenHash: "a".repeat(64),
              inviteExpiresAt: new Date(Date.now() + DAY),
              invitedAt: new Date(Date.now() - ageMs),
            }));

          // 49 of A's, plus 50 of B's, which must not count against A.
          await tx
            .insert(clientContacts)
            .values([
              ...recent(49, fixture.orgA, fixture.clientA2, HOUR),
              ...recent(50, fixture.orgB, fixture.clientB1, HOUR),
            ]);

          expect(
            (await sendInvitation({ contactId: fixture.contactA1 })).ok,
          ).toBe(true);

          // That send made 50. The next contact is refused.
          const [another] = await tx
            .insert(clientContacts)
            .values({
              id: newId(),
              orgId: fixture.orgA,
              clientId: fixture.clientA2,
              email: `more-${fixture.tag}@example.test`,
              name: "More",
            })
            .returning({ id: clientContacts.id });

          expect(await sendInvitation({ contactId: another.id })).toMatchObject(
            {
              ok: false,
              error: { code: "rate_limited" },
            },
          );

          // A stamp exactly a day old is outside the window, so it frees a slot.
          await tx
            .update(clientContacts)
            .set({ invitedAt: new Date(Date.now() - DAY - 1000) })
            .where(eq(clientContacts.id, fixture.contactA1));

          expect((await sendInvitation({ contactId: another.id })).ok).toBe(
            true,
          );
        });
      });
    });

    describe("updateContact (AC-2)", () => {
      it("clears a pending invitation when the email changes", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();

          const result = await updateContact({
            contactId: fixture.contactA1,
            name: "Ada L",
            email: `new-${fixture.tag}@example.test`,
          });
          expect(result.ok).toBe(true);

          const row = await rowOf(tx, fixture.contactA1);
          expect(row).toMatchObject({
            name: "Ada L",
            email: `new-${fixture.tag}@example.test`,
            inviteTokenHash: null,
            inviteExpiresAt: null,
            invitedAt: null,
            invitedByUserId: null,
          });
          expect(
            await inspectInvitation(identityFor(token, "user_x", [row!.email])),
          ).toMatchObject({ kind: "invalid" });
        });
      });

      it("keeps the invitation when only the name changes", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const before = await rowOf(tx, fixture.contactA1);

          expect(
            (
              await updateContact({
                contactId: fixture.contactA1,
                name: "Renamed",
                email: fixture.contactA1Email,
              })
            ).ok,
          ).toBe(true);

          const after = await rowOf(tx, fixture.contactA1);
          expect(after?.inviteTokenHash).toBe(before?.inviteTokenHash);
          expect(after?.invitedAt).toEqual(before?.invitedAt);
          expect(after?.name).toBe("Renamed");
        });
      });

      it("refuses an email change on an accepted contact, and allows a name change", async () => {
        await inRollback(async (tx, fixture) => {
          const refused = await updateContact({
            contactId: fixture.contactAccepted,
            name: "Accepted",
            email: `other-${fixture.tag}@example.test`,
          });
          expect(refused).toMatchObject({
            ok: false,
            error: {
              code: "conflict",
              fieldErrors: { email: expect.any(Array) },
            },
          });

          const renamed = await updateContact({
            contactId: fixture.contactAccepted,
            name: "Accepted Renamed",
            email: `portal-${fixture.tag}@example.test`,
          });
          expect(renamed.ok).toBe(true);
          expect((await rowOf(tx, fixture.contactAccepted))?.userId).toBe(
            fixture.portalUser,
          );
        });
      });

      it("refuses a change to an email another contact of the client already has", async () => {
        await inRollback(async (_tx, fixture) => {
          const result = await updateContact({
            contactId: fixture.contactA1,
            name: "Ada",
            email: `portal-${fixture.tag}@example.test`,
          });
          expect(result).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });
        });
      });
    });

    describe("revokeInvitation (AC-7)", () => {
      it("nulls every invitation column and the old link fails", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();

          expect(
            (await revokeInvitation({ contactId: fixture.contactA1 })).ok,
          ).toBe(true);

          expect(await rowOf(tx, fixture.contactA1)).toMatchObject({
            inviteTokenHash: null,
            inviteExpiresAt: null,
            invitedAt: null,
            invitedByUserId: null,
          });
          expect(
            await inspectInvitation(
              identityFor(token, "user_x", [fixture.contactA1Email]),
            ),
          ).toMatchObject({ kind: "invalid" });
        });
      });

      it("succeeds with no change when nothing is pending, and refuses an accepted contact", async () => {
        await inRollback(async (tx, fixture) => {
          const before = await rowOf(tx, fixture.contactA1);
          expect(
            await revokeInvitation({ contactId: fixture.contactA1 }),
          ).toEqual({ ok: true, data: { id: fixture.contactA1 } });
          expect(await rowOf(tx, fixture.contactA1)).toEqual(before);

          expect(
            await revokeInvitation({ contactId: fixture.contactAccepted }),
          ).toMatchObject({ ok: false, error: { code: "conflict" } });
        });
      });
    });

    describe("removeContact (AC-8)", () => {
      it("hard deletes, reports the id either way, and the link fails afterwards", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();

          expect(await removeContact({ contactId: fixture.contactA1 })).toEqual(
            { ok: true, data: { id: fixture.contactA1 } },
          );
          expect(await rowOf(tx, fixture.contactA1)).toBeUndefined();
          expect(await removeContact({ contactId: fixture.contactA1 })).toEqual(
            { ok: true, data: { id: fixture.contactA1 } },
          );

          expect(
            await inspectInvitation(
              identityFor(token, "user_x", [fixture.contactA1Email]),
            ),
          ).toEqual({ kind: "invalid" });
        });
      });
    });

    describe("acceptance (AC-9, AC-10, AC-11)", () => {
      it("binds once, clears the digest, and treats the accepter's second visit as already yours", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();
          const clerkUserId = `user_${fixture.tag}_new`;
          const identity = identityFor(token, clerkUserId, [
            "other@example.test",
            fixture.contactA1Email,
          ]);
          const mirror = mirrorOf(fixture, "other@example.test", clerkUserId);

          expect(await inspectInvitation(identity)).toMatchObject({
            kind: "acceptable",
            clientName: "Client A1",
            agencyName: "Agency A",
            contactEmail: fixture.contactA1Email,
          });

          const first = await acceptInvitation(identity, mirror);
          expect(first).toEqual({
            kind: "accepted",
            contactId: fixture.contactA1,
            orgId: fixture.orgA,
          });

          const row = await rowOf(tx, fixture.contactA1);
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.clerkUserId, clerkUserId));
          expect(user).toBeDefined();
          expect(row).toMatchObject({
            userId: user.id,
            inviteTokenHash: null,
            inviteExpiresAt: null,
          });
          expect(row?.acceptedAt).not.toBeNull();

          const second = await acceptInvitation(identity, mirror);
          expect(second).toEqual({
            kind: "already_yours",
            contactId: fixture.contactA1,
            orgId: fixture.orgA,
          });
          expect(await inspectInvitation(identity)).toEqual({
            kind: "already_yours",
            contactId: fixture.contactA1,
            orgId: fixture.orgA,
          });
          expect((await rowOf(tx, fixture.contactA1))?.acceptedAt).toEqual(
            row?.acceptedAt,
          );

          // Anyone else, same link, after acceptance: nothing.
          const stranger = identityFor(token, "user_stranger", [
            fixture.contactA1Email,
          ]);
          expect(await inspectInvitation(stranger)).toMatchObject({
            kind: "invalid",
          });
          expect(
            (
              await acceptInvitation(
                stranger,
                mirrorOf(fixture, fixture.contactA1Email, "user_stranger"),
              )
            ).kind,
          ).toBe("refused");
          expect((await rowOf(tx, fixture.contactA1))?.userId).toBe(user.id);
        });
      });

      it("refuses a user whose verified emails do not include the contact's, without writing", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();
          const snapshot = await rowOf(tx, fixture.contactA1);

          // The matching address is present but not in the verified list.
          const identity = identityFor(token, "user_wrong", [
            "someone-else@example.test",
          ]);
          expect(await inspectInvitation(identity)).toEqual({
            kind: "wrong_account",
            contactId: fixture.contactA1,
            orgId: fixture.orgA,
          });
          expect(
            (
              await acceptInvitation(
                identity,
                mirrorOf(fixture, "someone-else@example.test", "user_wrong"),
              )
            ).kind,
          ).toBe("refused");
          expect(await rowOf(tx, fixture.contactA1)).toEqual(snapshot);
        });
      });

      it("treats an expired link and an archived client as invalid, without writing", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();
          const identity = identityFor(token, "user_late", [
            fixture.contactA1Email,
          ]);
          const mirror = mirrorOf(fixture, fixture.contactA1Email, "user_late");

          await tx
            .update(clientContacts)
            .set({ inviteExpiresAt: new Date(Date.now() - 7 * DAY - 1000) })
            .where(eq(clientContacts.id, fixture.contactA1));

          expect(await inspectInvitation(identity)).toMatchObject({
            kind: "invalid",
          });
          expect((await acceptInvitation(identity, mirror)).kind).toBe(
            "refused",
          );

          await tx
            .update(clientContacts)
            .set({ inviteExpiresAt: new Date(Date.now() + DAY) })
            .where(eq(clientContacts.id, fixture.contactA1));
          await tx
            .update(clients)
            .set({ archivedAt: new Date() })
            .where(eq(clients.id, fixture.clientA1));

          expect(await inspectInvitation(identity)).toMatchObject({
            kind: "invalid",
          });
          expect((await acceptInvitation(identity, mirror)).kind).toBe(
            "refused",
          );
          expect((await rowOf(tx, fixture.contactA1))?.userId).toBeNull();
        });
      });

      it("the Server Action binds, sets the contact cookie and redirects to /portal (AC-10)", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();

          actAsNewPerson(fixture, [
            "other@example.test",
            fixture.contactA1Email,
          ]);

          expect(await runAcceptAction(token)).toEqual({
            redirectedTo: "/portal",
          });
          expect(state.jar.get("clienthq_contact")).toMatchObject({
            value: fixture.contactA1,
            options: {
              httpOnly: true,
              sameSite: "lax",
              path: "/",
              maxAge: 60 * 60 * 24 * 365,
            },
          });
          expect((await rowOf(tx, fixture.contactA1))?.userId).not.toBeNull();

          // Again, same person: cookie and redirect, no write.
          const accepted = (await rowOf(tx, fixture.contactA1))?.acceptedAt;
          state.jar.clear();
          expect(await runAcceptAction(token)).toEqual({
            redirectedTo: "/portal",
          });
          expect(state.jar.get("clienthq_contact")?.value).toBe(
            fixture.contactA1,
          );
          expect((await rowOf(tx, fixture.contactA1))?.acceptedAt).toEqual(
            accepted,
          );
        });
      });

      it("the Server Action answers forbidden for a mismatch or a malformed token, and unauthenticated with no session", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();
          const snapshot = await rowOf(tx, fixture.contactA1);

          actAsNewPerson(fixture, ["someone-else@example.test"]);
          expect(await runAcceptAction(token)).toMatchObject({
            result: { ok: false, error: { code: "forbidden" } },
          });
          expect(await runAcceptAction("not.a.token")).toMatchObject({
            result: { ok: false, error: { code: "forbidden" } },
          });
          expect(state.jar.size).toBe(0);

          state.claims = {
            clerkUserId: undefined,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };
          expect(await runAcceptAction(token)).toMatchObject({
            result: { ok: false, error: { code: "unauthenticated" } },
          });

          expect(await rowOf(tx, fixture.contactA1)).toEqual(snapshot);
        });
      });

      it("treats a malformed or unknown token as invalid", async () => {
        await inRollback(async (_tx, fixture) => {
          const unknown = identityFor(
            `${newId()}.${"a".repeat(43)}`,
            "user_x",
            [fixture.contactA1Email],
          );
          expect(await inspectInvitation(unknown)).toEqual({ kind: "invalid" });

          const notInvited = identityFor(
            `${fixture.contactA1}.${"a".repeat(43)}`,
            "user_x",
            [fixture.contactA1Email],
          );
          expect(await inspectInvitation(notInvited)).toMatchObject({
            kind: "invalid",
          });
        });
      });
    });

    describe("the fence (AC-12, AC-13)", () => {
      it("resolves another agency's contact as not_found on every action, with the row unchanged", async () => {
        await inRollback(async (tx, fixture) => {
          const before = await rowOf(tx, fixture.contactA1);
          actAsStaff(fixture, "B");

          expect(
            await sendInvitation({ contactId: fixture.contactA1 }),
          ).toMatchObject({ ok: false, error: { code: "not_found" } });
          expect(
            await revokeInvitation({ contactId: fixture.contactA1 }),
          ).toMatchObject({ ok: false, error: { code: "not_found" } });
          expect(
            await updateContact({
              contactId: fixture.contactA1,
              name: "Taken",
              email: fixture.contactA1Email,
            }),
          ).toMatchObject({ ok: false, error: { code: "not_found" } });
          expect(await removeContact({ contactId: fixture.contactA1 })).toEqual(
            { ok: true, data: { id: fixture.contactA1 } },
          );
          expect(
            await addContact({
              clientId: fixture.clientA1,
              name: "X",
              email: "x@example.test",
            }),
          ).toMatchObject({ ok: false, error: { code: "not_found" } });

          expect(await rowOf(tx, fixture.contactA1)).toEqual(before);
          expect(state.sent).toHaveLength(0);
        });
      });

      it("refuses a client contact context on every action", async () => {
        await inRollback(async (tx, fixture) => {
          actAsContact(fixture);
          const before = await rowOf(tx, fixture.contactA1);

          const results = await Promise.all([
            addContact({
              clientId: fixture.clientA1,
              name: "X",
              email: "x@example.test",
            }),
            sendInvitation({ contactId: fixture.contactA1 }),
            updateContact({
              contactId: fixture.contactA1,
              name: "X",
              email: fixture.contactA1Email,
            }),
            revokeInvitation({ contactId: fixture.contactA1 }),
            removeContact({ contactId: fixture.contactA1 }),
          ]);

          results.forEach((result) => {
            expect(result).toMatchObject({
              ok: false,
              error: { code: "forbidden" },
            });
          });
          expect(await rowOf(tx, fixture.contactA1)).toEqual(before);
        });
      });

      it("refuses every staff write on a lapsed subscription while acceptance still binds", async () => {
        await inRollback(async (tx, fixture) => {
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();

          await tx
            .update(subscriptions)
            .set({
              status: "past_due",
              pastDueSince: new Date(Date.now() - 8 * DAY),
            })
            .where(eq(subscriptions.id, fixture.subscriptionA));

          const results = await Promise.all([
            addContact({
              clientId: fixture.clientA1,
              name: "X",
              email: "x@example.test",
            }),
            sendInvitation({ contactId: fixture.contactA1 }),
            updateContact({
              contactId: fixture.contactA1,
              name: "X",
              email: fixture.contactA1Email,
            }),
            revokeInvitation({ contactId: fixture.contactA1 }),
            removeContact({ contactId: fixture.contactA1 }),
          ]);

          results.forEach((result) => {
            expect(result).toMatchObject({
              ok: false,
              error: { code: "subscription_inactive" },
            });
          });

          const identity = identityFor(token, "user_paid", [
            fixture.contactA1Email,
          ]);
          expect(
            (
              await acceptInvitation(
                identity,
                mirrorOf(fixture, fixture.contactA1Email, "user_paid"),
              )
            ).kind,
          ).toBe("accepted");
        });
      });
    });

    describe("the log lines (AC-15)", () => {
      it("writes one line per send, failure, revoke, remove and accept, with ids and no secrets", async () => {
        await inRollback(async (tx, fixture) => {
          state.emailOutcomes.push("fail");
          await sendInvitation({ contactId: fixture.contactA1 });
          await sendInvitation({ contactId: fixture.contactA1 });
          const token = await lastToken();
          const digest =
            (await rowOf(tx, fixture.contactA1))?.inviteTokenHash ?? "";

          actAsNewPerson(fixture, [fixture.contactA1Email]);
          await runAcceptAction(token);
          actAsStaff(fixture, "A");

          // A fresh pending contact to revoke and remove.
          const added = await addContact({
            clientId: fixture.clientA2,
            name: "Log",
            email: `log-${fixture.tag}@example.test`,
          });
          if (!added.ok) throw new Error("add failed");
          await sendInvitation({ contactId: added.data.id });
          await revokeInvitation({ contactId: added.data.id });
          await removeContact({ contactId: added.data.id });

          const lines = contactLines();
          const operations = lines.map(
            (line) => `${line.operation}:${line.outcome}`,
          );

          expect(operations).toEqual([
            "send_failed:provider_refused",
            "send:resent",
            "accept:accepted",
            "send:sent",
            "revoke:revoked",
            "remove:removed",
          ]);

          lines.forEach((line) => {
            expect(line.orgId).toBe(fixture.orgA);
            expect(line.contactId).toMatch(/^[0-9a-f-]{36}$/u);
          });

          const raw = logged
            .filter((line) => line.includes("contacts.invitation"))
            .join("\n");
          expect(raw).not.toContain(token.split(".")[1]);
          expect(raw).not.toContain(digest);
          expect(raw).not.toContain("@");
        });
      });
    });
  },
);
