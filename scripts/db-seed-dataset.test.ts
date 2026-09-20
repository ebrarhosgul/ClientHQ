/**
 * @vitest-environment node
 *
 * The seeded story, checked as data: no database, no network. `buildDataset`
 * is pure given a clock, so these fix "now" and read the rows back.
 *
 * What is worth pinning: the four invoices are the four the demo needs, with
 * the totals and dates they are meant to have; the visibility mix is really a
 * mix; every timestamp sits inside the last 60 days and in causal order; and
 * the arithmetic satisfies the database's own CHECK constraints, since a seed
 * that a CHECK rejects fails halfway through a live transaction.
 */
import { describe, expect, it } from "vitest";

import {
  buildDataset,
  CLIENT,
  INVOICE,
  ORG,
  PROJECT,
  SEED_ID_PREFIX,
} from "./seed-dataset";
import { minimalPdf } from "./seed-files";

const NOW = new Date("2026-09-20T15:30:00Z");
const DAY_MS = 86_400_000;
const data = buildDataset({ now: NOW, priyaClerkUserId: "user_priya_test" });

const invoice = (id: string) => {
  const found = data.invoices.find((row) => row.id === id);
  if (found === undefined) throw new Error(`no invoice ${id}`);
  return found;
};

const lines = (id: string) =>
  data.invoiceLineItems.filter((row) => row.invoiceId === id);

const events = (id: string) =>
  data.invoiceEvents.filter((row) => row.invoiceId === id);

describe("the agency", () => {
  const apex = data.apexProfile;

  it("is Apex Interactive Studio, with a business profile for /settings", () => {
    expect(data.organizations.find((row) => row.id === ORG)).toMatchObject(
      apex,
    );
    expect(apex).toMatchObject({
      name: "Apex Interactive Studio",
      description: "Digital product and engineering agency.",
      taxId: "US-9482019",
      defaultCurrency: "USD",
    });
    expect(apex.addressLine1).toBeTruthy();
    expect(apex.city).toBeTruthy();
    expect(apex.country).toBeTruthy();
  });

  it("has an admin and two members", () => {
    const roles = data.memberships
      .filter((row) => row.orgId === ORG)
      .map((row) => row.role)
      .sort();

    expect(roles).toEqual(["admin", "member", "member"]);
  });

  it("has an active subscription", () => {
    expect(data.subscriptions.find((row) => row.orgId === ORG)?.status).toBe(
      "active",
    );
  });
});

describe("the clients and projects", () => {
  it("has the two clients under Apex, with the projects the demo names", () => {
    const apexClients = data.clients.filter((row) => row.orgId === ORG);
    expect(apexClients.map((row) => row.name).sort()).toEqual([
      "Harbor Lane Capital",
      "Northstar Cloud Solutions",
    ]);

    const project = (id: string) => data.projects.find((row) => row.id === id);

    expect(project(PROJECT.designSystem)).toMatchObject({
      name: "Design System v2 Migration",
      clientId: CLIENT.northstar,
      status: "in_progress",
    });
    expect(project(PROJECT.mobileApp)).toMatchObject({
      name: "Q3 Mobile App Overhaul",
      clientId: CLIENT.northstar,
      status: "delivered",
    });
    expect(project(PROJECT.onboarding)).toMatchObject({
      name: "Client Onboarding Flow Redesign",
      clientId: CLIENT.harborLane,
      status: "in_review",
    });
  });
});

describe("the deliverables", () => {
  const deliverables = data.deliverables;

  it("mixes client visible and internal files, and one still pending", () => {
    const ready = deliverables.filter((row) => row.status === "ready");

    expect(ready.some((row) => row.visibleToClient === true)).toBe(true);
    expect(ready.some((row) => row.visibleToClient === false)).toBe(true);
    expect(deliverables.filter((row) => row.status === "pending")).toHaveLength(
      1,
    );
  });

  it("includes the three named files, shared with the client", () => {
    for (const name of [
      "design-tokens-v2.1.json",
      "executive-summary.pdf",
      "architecture-diagram.png",
    ]) {
      expect(
        deliverables.find((row) => row.name === name)?.visibleToClient,
      ).toBe(true);
    }
  });

  it("gives every project at least one file the client can see", () => {
    for (const project of Object.values(PROJECT)) {
      expect(
        deliverables.some(
          (row) =>
            row.projectId === project &&
            row.status === "ready" &&
            row.visibleToClient,
        ),
      ).toBe(true);
    }
  });

  it("records each ready file's real byte length, so a download matches its row", () => {
    for (const row of deliverables.filter((d) => d.status === "ready")) {
      const object = data.objects.find((o) => o.key === row.r2Key);

      expect(object?.bytes.length).toBe(row.sizeBytes);
      expect(object?.contentType).toBe(row.contentType);
      expect(row.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("uploads nothing for the pending row, and keys are unique", () => {
    const pending = deliverables.find((row) => row.status === "pending");

    expect(data.objects.some((o) => o.key === pending?.r2Key)).toBe(false);
    expect(new Set(deliverables.map((row) => row.r2Key)).size).toBe(
      deliverables.length,
    );
  });

  it("keeps the pending row young enough that the abandoned upload sweep leaves it", () => {
    const pending = deliverables.find((row) => row.status === "pending");

    expect(NOW.getTime() - (pending?.createdAt?.getTime() ?? 0)).toBeLessThan(
      DAY_MS,
    );
  });
});

describe("the seeded files are valid", () => {
  const bytes = (name: string) => {
    const object = data.objects.find((o) => o.name === name);
    if (object === undefined) throw new Error(`no object ${name}`);
    return object.bytes;
  };

  it("has a JSON tokens file that parses", () => {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(bytes("design-tokens-v2.1.json")),
    );

    expect(parsed).toMatchObject({ version: "2.1.0" });
  });

  it("has a PNG with the signature and the diagram's dimensions", () => {
    const png = bytes("architecture-diagram.png");
    const view = new DataView(png.buffer, png.byteOffset);

    expect(Array.from(png.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(view.getUint32(16)).toBe(480);
    expect(view.getUint32(20)).toBe(270);
  });

  it("has a PDF whose cross reference table points at every object", () => {
    const pdf = new TextDecoder().decode(bytes("executive-summary.pdf"));

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");

    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)];
    expect(offsets).toHaveLength(5);
    offsets.forEach((match, index) => {
      expect(pdf.slice(Number(match[1])).startsWith(`${index + 1} 0 obj`)).toBe(
        true,
      );
    });
  });

  it("escapes parentheses in PDF text", () => {
    const pdf = new TextDecoder().decode(minimalPdf("A (b) c", []));

    expect(pdf).toContain("(A \\(b\\) c) Tj");
  });
});

describe("the invoices", () => {
  it("has INV-0001, paid, $6,500.00, with issued, notified and paid history", () => {
    const row = invoice(INVOICE.paid);

    expect(row).toMatchObject({
      status: "paid",
      number: 1,
      totalCents: 650_000,
      clientId: CLIENT.northstar,
    });
    expect(row.paidAt).toBeInstanceOf(Date);
    expect(events(INVOICE.paid).map((e) => e.kind)).toEqual([
      "issued",
      "notified",
      "paid",
    ]);
  });

  it("has INV-0002, sent, $3,850.00, issued 5 days ago and due in 10", () => {
    const row = invoice(INVOICE.sent);

    expect(row).toMatchObject({
      status: "sent",
      number: 2,
      totalCents: 385_000,
      issueDate: "2026-09-15",
      dueDate: "2026-09-30",
    });
    expect(events(INVOICE.sent).map((e) => e.kind)).toEqual([
      "issued",
      "notified",
    ]);
  });

  it("has INV-0003, overdue, $1,200.00, four days past its due date", () => {
    const row = invoice(INVOICE.overdue);

    expect(row).toMatchObject({
      status: "overdue",
      number: 3,
      totalCents: 120_000,
      dueDate: "2026-09-16",
      clientId: CLIENT.harborLane,
    });
    expect(events(INVOICE.overdue).map((e) => e.kind)).toContain("overdue");
  });

  it("has a $4,200.00 draft with no number, no dates and no history", () => {
    const row = invoice(INVOICE.draft);

    expect(row).toMatchObject({ status: "draft", totalCents: 420_000 });
    expect(row.number).toBeUndefined();
    expect(row.issueDate).toBeUndefined();
    expect(row.dueDate).toBeUndefined();
    expect(events(INVOICE.draft)).toEqual([]);
  });

  it("numbers the issued invoices 1 to 3 and leaves the next number at 4", () => {
    const numbers = data.invoices
      .flatMap((row) => (row.number === undefined ? [] : [row.number]))
      .sort();

    expect(numbers).toEqual([1, 2, 3]);
    expect(data.apexProfile.nextInvoiceNumber).toBe(4);
  });

  it("bills every line as hours at an hourly rate", () => {
    for (const line of data.invoiceLineItems) {
      expect(Number(line.quantity)).toBeGreaterThan(0);
      expect(line.unitAmountCents % 100).toBe(0);
      expect(line.unitAmountCents).toBeGreaterThanOrEqual(10_000);
      expect(line.unitAmountCents).toBeLessThanOrEqual(15_000);
    }
  });

  it("satisfies the database's own arithmetic CHECKs", () => {
    for (const row of data.invoices) {
      const subtotal = lines(row.id ?? "").reduce(
        (total, line) => total + line.amountCents,
        0,
      );

      expect(row.subtotalCents).toBe(subtotal);
      expect(row.taxCents).toBe(
        Math.round(((row.subtotalCents ?? 0) * (row.taxRateBp ?? 0)) / 10_000),
      );
      expect(row.totalCents).toBe(
        (row.subtotalCents ?? 0) + (row.taxCents ?? 0),
      );
      // `paid_at` is present exactly when the status is paid.
      expect(row.paidAt !== undefined).toBe(row.status === "paid");
    }

    for (const line of data.invoiceLineItems) {
      expect(line.amountCents).toBe(
        Math.round(Number(line.quantity) * line.unitAmountCents),
      );
    }
  });

  it("gives every event both statuses or neither, as its CHECK requires", () => {
    for (const event of data.invoiceEvents) {
      const isMove = ["issued", "paid", "voided", "overdue"].includes(
        event.kind,
      );

      expect(event.fromStatus !== undefined).toBe(isMove);
      expect(event.toStatus !== undefined).toBe(isMove);
    }
  });

  it("lists each invoice's events in a strict order, never two at one instant", () => {
    for (const row of data.invoices) {
      const times = events(row.id ?? "").map(
        (e) => e.createdAt?.getTime() ?? 0,
      );

      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
    }
  });
});

describe("the portal contacts", () => {
  const accepted = (clientId: string) =>
    data.clientContacts.filter(
      (row) => row.clientId === clientId && row.acceptedAt !== undefined,
    );

  it("has an accepted contact at both companies, bound to a login", () => {
    for (const client of [CLIENT.northstar, CLIENT.harborLane]) {
      expect(accepted(client).length).toBeGreaterThanOrEqual(1);
      expect(accepted(client).every((row) => row.userId !== undefined)).toBe(
        true,
      );
    }
  });

  it("keeps one pending invitation, with an expiry and no login yet", () => {
    const pending = data.clientContacts.filter(
      (row) => row.acceptedAt === undefined && row.inviteTokenHash,
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.userId).toBeUndefined();
    expect(pending[0]?.inviteExpiresAt?.getTime()).toBeGreaterThan(
      NOW.getTime(),
    );
  });

  it("binds every one of Priya's rows to the one login the browser suite uses", () => {
    const priya = data.users.find((row) => row.name === "Priya Patel");
    const rows = data.clientContacts.filter((row) => row.userId === priya?.id);

    expect(priya?.clerkUserId).toBe("user_priya_test");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("opens Priya on Northstar: her most recently accepted row", () => {
    const priya = data.users.find((row) => row.name === "Priya Patel");
    const newest = data.clientContacts
      .filter((row) => row.userId === priya?.id)
      .sort(
        (a, b) =>
          (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0),
      )[0];

    expect(newest?.clientId).toBe(CLIENT.northstar);
  });

  it("stores every email lowercase, as the CHECK requires", () => {
    for (const row of [...data.users, ...data.clientContacts]) {
      expect(row.email).toBe(row.email.toLowerCase());
    }
  });
});

describe("the timeline", () => {
  const earliest = NOW.getTime() - 60 * DAY_MS;

  const stamps = [
    ...data.organizations,
    ...data.users,
    ...data.memberships,
    ...data.subscriptions,
    ...data.clients,
    ...data.clientContacts,
    ...data.projects,
    ...data.deliverables,
    ...data.invoices,
    ...data.invoiceLineItems,
    ...data.invoiceEvents,
  ].flatMap((row) =>
    [row.createdAt].flatMap((value) =>
      value === undefined ? [] : [value.getTime()],
    ),
  );

  it("backdates every row into the last 60 days, and none into the future", () => {
    expect(Math.min(...stamps)).toBeGreaterThanOrEqual(earliest);
    expect(Math.max(...stamps)).toBeLessThanOrEqual(NOW.getTime());
  });

  it("does not stamp everything in the same second", () => {
    expect(new Set(stamps).size).toBeGreaterThan(stamps.length / 2);
  });

  it("creates a client before its contacts are invited, and invites before accepting", () => {
    for (const contact of data.clientContacts) {
      const client = data.clients.find((row) => row.id === contact.clientId);

      expect(contact.createdAt?.getTime()).toBeGreaterThan(
        client?.createdAt?.getTime() ?? 0,
      );

      if (contact.invitedAt !== undefined && contact.acceptedAt !== undefined) {
        expect(contact.acceptedAt.getTime()).toBeGreaterThan(
          contact.invitedAt.getTime(),
        );
      }
    }
  });

  it("creates each project after its client and each file after its project", () => {
    for (const project of data.projects) {
      const client = data.clients.find((row) => row.id === project.clientId);
      expect(project.createdAt?.getTime()).toBeGreaterThan(
        client?.createdAt?.getTime() ?? 0,
      );
    }

    for (const file of data.deliverables) {
      const project = data.projects.find((row) => row.id === file.projectId);
      expect(file.createdAt?.getTime()).toBeGreaterThan(
        project?.createdAt?.getTime() ?? 0,
      );
    }
  });

  it("issues each invoice after its client exists and after the draft was made", () => {
    for (const row of data.invoices) {
      const client = data.clients.find((c) => c.id === row.clientId);
      const firstEvent = events(row.id ?? "")[0];

      expect(row.createdAt?.getTime()).toBeGreaterThan(
        client?.createdAt?.getTime() ?? 0,
      );

      if (firstEvent !== undefined) {
        expect(firstEvent.createdAt?.getTime()).toBeGreaterThan(
          row.createdAt?.getTime() ?? 0,
        );
      }
    }
  });
});

describe("ids", () => {
  it("are unique across every table and all inside the seed's namespace", () => {
    const ids = [
      ...data.organizations,
      ...data.users,
      ...data.memberships,
      ...data.subscriptions,
      ...data.clients,
      ...data.clientContacts,
      ...data.projects,
      ...data.deliverables,
      ...data.invoices,
      ...data.invoiceLineItems,
      ...data.invoiceEvents,
    ].map((row) => row.id ?? "");

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(SEED_ID_PREFIX))).toBe(true);
  });

  it("stay the same across runs, which is what makes a second seed a replace", () => {
    const later = buildDataset({
      now: new Date(NOW.getTime() + 3 * DAY_MS),
      priyaClerkUserId: "user_priya_test",
    });

    expect(later.invoices.map((row) => row.id)).toEqual(
      data.invoices.map((row) => row.id),
    );
    expect(later.deliverables.map((row) => row.r2Key)).toEqual(
      data.deliverables.map((row) => row.r2Key),
    );
  });
});

describe("bound to a real Clerk organization", () => {
  const REAL_ORG = "01a0c000-0000-7000-8000-00000000aaaa";
  const REAL_ADMIN = "01a0c000-0000-7000-8000-00000000bbbb";

  const bound = (needsSubscription: boolean) =>
    buildDataset({
      now: NOW,
      priyaClerkUserId: "user_priya_test",
      placement: {
        orgId: REAL_ORG,
        ownerId: REAL_ADMIN,
        bound: true,
        needsSubscription,
      },
    });

  const dataBound = bound(false);

  it("writes no organization row for Apex, only the profile to apply to the real one", () => {
    expect(dataBound.organizations.map((row) => row.id)).not.toContain(
      REAL_ORG,
    );
    expect(dataBound.organizations.map((row) => row.name)).toEqual([
      "Harbor Lane",
      "Anchor Ridge",
    ]);
    expect(dataBound.apexProfile.name).toBe("Apex Interactive Studio");
  });

  it("puts every Apex row under the real organization and none under the seeded one", () => {
    const apexClients = dataBound.clients.filter((row) =>
      ["Northstar Cloud Solutions", "Harbor Lane Capital"].includes(row.name),
    );

    for (const rows of [
      apexClients,
      dataBound.projects,
      dataBound.deliverables,
      dataBound.invoices,
      dataBound.invoiceLineItems,
      dataBound.invoiceEvents,
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.orgId === REAL_ORG)).toBe(true);
    }
  });

  it("makes the real admin the owner, and adds no user or membership for Sarah Chen", () => {
    expect(dataBound.users.map((row) => row.name)).not.toContain("Sarah Chen");
    expect(dataBound.memberships.map((row) => row.userId)).not.toContain(
      REAL_ADMIN,
    );
    expect(
      dataBound.invoiceEvents
        .filter((row) => row.actorUserId !== undefined)
        .every((row) => row.actorUserId === REAL_ADMIN),
    ).toBe(true);
    expect(
      dataBound.deliverables.some((row) => row.uploadedByUserId === REAL_ADMIN),
    ).toBe(true);
  });

  it("keys the files under the real organization, so they sit where the app puts them", () => {
    expect(
      dataBound.deliverables.every((row) =>
        row.r2Key.startsWith(`org/${REAL_ORG}/project/`),
      ),
    ).toBe(true);
    expect(
      dataBound.objects.every((o) => o.key.startsWith(`org/${REAL_ORG}/`)),
    ).toBe(true);
  });

  it("keeps the real subscription, and only seeds one when the organization has none", () => {
    const apexSubscriptions = (data: typeof dataBound) =>
      data.subscriptions.filter((row) => row.orgId === REAL_ORG);

    expect(apexSubscriptions(dataBound)).toEqual([]);
    expect(apexSubscriptions(bound(true))).toHaveLength(1);
  });

  it("is otherwise the same story: the same four invoices with the same totals", () => {
    expect(dataBound.invoices.map((row) => row.totalCents)).toEqual(
      data.invoices.map((row) => row.totalCents),
    );
  });
});
