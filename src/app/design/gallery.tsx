import {
  Archive,
  Ellipsis,
  FileText,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import { GraceBanner } from "@/access/ui/grace-banner";
import { AcceptInvitationCard } from "@/contacts/ui/accept-invitation-card";
import { ContactsSectionView } from "@/contacts/ui/contacts-section-view";
import {
  ACCEPT_STATE_FIXTURES,
  CONTACT_FIXTURES,
} from "@/contacts/ui/fixtures";
import { LockedNotice } from "@/access/ui/locked-notice";
import type { InvoiceStatus } from "@/db/schema";
import { AddressFields } from "@/ui/patterns/address-fields";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { PageHeader } from "@/ui/patterns/page-header";
import {
  DeliverableStatusChip,
  InvoiceStatusChip,
  ProjectStatusChip,
  StatusChip,
  SUBSCRIPTION_ACCESS_PRESENTATION,
} from "@/ui/patterns/status-chip";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { Avatar, AvatarFallback } from "@/ui/primitives/avatar";
import { Badge } from "@/ui/primitives/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/primitives/breadcrumb";
import { Button } from "@/ui/primitives/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";
import { Checkbox } from "@/ui/primitives/checkbox";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/ui/primitives/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Separator } from "@/ui/primitives/separator";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";
import { Switch } from "@/ui/primitives/switch";
import { Textarea } from "@/ui/primitives/textarea";

/**
 * Every component in every state, rendered from fixtures.
 *
 * This is what makes the feature verifiable at all: `/check verify`, the axe
 * suites and a person with a screen reader all need something real to point at,
 * and no feature screen exists yet. It is rendered twice by the page, once per
 * theme, so a component that only works in one palette is visible immediately.
 *
 * Server only, no interactivity beyond what each component brings. The
 * overlay components (dialog, sheet, dropdown, tooltip) are exercised in the
 * shell and by the manual pass, not here, because opening them needs a client
 * component and this page is deliberately static.
 */

function Section({
  id,
  title,
  description,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex flex-col gap-1">
        <h3 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : undefined}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Fixture only. How money is written on screen (locale, symbol placement,
 * whether a zero shows as a dash) is feature 13's decision, not this feature's,
 * so nothing shared is introduced here for it.
 */
function fixtureMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type InvoiceRow = {
  readonly id: string;
  readonly number: string;
  readonly client: string;
  readonly amountCents: number;
  readonly status: InvoiceStatus;
  readonly issuedOn: string;
  readonly createdBy: string;
};

const INVOICE_ROWS: readonly InvoiceRow[] = [
  {
    id: "1",
    number: "INV-2026-0041",
    client: "Northwind Coffee",
    amountCents: 480000,
    status: "sent",
    issuedOn: "2026-08-14",
    createdBy: "Priya Raman",
  },
  {
    id: "2",
    number: "INV-2026-0040",
    client: "Harbour Books",
    amountCents: 125050,
    status: "paid",
    issuedOn: "2026-08-02",
    createdBy: "Priya Raman",
  },
  {
    id: "3",
    number: "INV-2026-0039",
    client: "Ridgeline Fitness",
    amountCents: 96000,
    status: "overdue",
    issuedOn: "2026-07-19",
    createdBy: "Sam Okafor",
  },
  {
    id: "4",
    number: "INV-2026-0038",
    client: "Northwind Coffee",
    amountCents: 210000,
    status: "void",
    issuedOn: "2026-07-11",
    createdBy: "Sam Okafor",
  },
];

/**
 * Shaped like the real invoice list feature 13 will build, so the responsive
 * rule is provable before that feature exists (AC-10): invoice number, client,
 * amount and status are `high`; issued date and created by are `low`.
 */
const INVOICE_COLUMNS: readonly Column<InvoiceRow>[] = [
  {
    key: "number",
    header: "Invoice",
    priority: "high",
    identifying: true,
    cell: (row) => <span className="font-mono">{row.number}</span>,
  },
  {
    key: "client",
    header: "Client",
    priority: "high",
    cell: (row) => row.client,
  },
  {
    key: "amount",
    header: "Amount",
    priority: "high",
    align: "end",
    cell: (row) => fixtureMoney(row.amountCents),
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cell: (row) => <InvoiceStatusChip status={row.status} />,
  },
  {
    key: "issued",
    header: "Issued",
    priority: "low",
    cell: (row) => <time dateTime={row.issuedOn}>{row.issuedOn}</time>,
  },
  {
    key: "createdBy",
    header: "Created by",
    priority: "low",
    cell: (row) => row.createdBy,
  },
];

/**
 * The gallery is rendered twice on one page, once per palette. Every id and
 * every form field name is prefixed so the two copies do not collide: a
 * duplicate id silently breaks `htmlFor`, which is the sort of thing a gallery
 * exists to catch rather than to introduce.
 */
export function Gallery({ prefix }: { readonly prefix: string }) {
  const scoped = (name: string) => `${prefix}-${name}`;

  return (
    <div className="flex flex-col gap-10">
      <Section
        id={scoped("type")}
        title="Type"
        description="Tailwind's default scale, unchanged. What is fixed is the usage."
      >
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <p className="text-xl font-semibold tracking-tight">
            Page title, text-xl semibold
          </p>
          <p className="text-base font-semibold">
            Section heading, text-base semibold
          </p>
          <p className="text-sm">Body and table cells, text-sm</p>
          <p className="text-xs text-muted-foreground">
            Secondary and metadata, text-xs muted
          </p>
          <p className="font-mono text-sm tabular-nums">
            INV-2026-0041 · 4,800.00 · JetBrains Mono, tabular
          </p>
        </div>
      </Section>

      <Section
        id={scoped("buttons")}
        title="Buttons"
        description="Six variants, six sizes, every state. The smallest icon button is 24 square, the WCAG 2.2 minimum."
      >
        <Row label="variant">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="size">
          <Button size="lg">Large</Button>
          <Button>Default</Button>
          <Button size="sm">Small</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
          <Button size="icon-sm" aria-label="Edit">
            <Pencil />
          </Button>
          <Button size="icon-xs" aria-label="More">
            <Ellipsis />
          </Button>
        </Row>
        <Row label="disabled">
          <Button disabled>Default</Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
          <Button variant="outline" disabled>
            Outline
          </Button>
          <Button variant="ghost" disabled>
            Ghost
          </Button>
          <Button variant="destructive" disabled>
            Destructive
          </Button>
          <Button variant="link" disabled>
            Link
          </Button>
        </Row>
        <Row label="with an icon">
          <Button>
            <Plus />
            New client
          </Button>
          <Button variant="outline">
            <Search />
            Search
          </Button>
        </Row>
      </Section>

      <Section
        id={scoped("form-fields")}
        title="Form fields"
        description="The Field wrapper generates the ids and wires aria-describedby and aria-invalid from a Result failure."
      >
        <div className="grid gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-2">
          <Field name={scoped("client-name")} label="Client name" required>
            {(props) => <Input {...props} defaultValue="Northwind Coffee" />}
          </Field>

          <Field
            name={scoped("reference")}
            label="Purchase order"
            description="Printed on every invoice for this client."
          >
            {(props) => <Input {...props} placeholder="Optional" />}
          </Field>

          <Field
            name={scoped("contact-email")}
            label="Billing email"
            error={["Enter an email address like name@company.com."]}
          >
            {(props) => (
              <Input {...props} type="email" defaultValue="not-an-email" />
            )}
          </Field>

          <Field name={scoped("locked")} label="Invoice number">
            {(props) => (
              <Input {...props} readOnly defaultValue="INV-2026-0041" />
            )}
          </Field>

          <Field name={scoped("disabled-field")} label="Currency">
            {(props) => <Input {...props} disabled defaultValue="USD" />}
          </Field>

          <Field name={scoped("terms")} label="Payment terms">
            {(props) => (
              <Select defaultValue="net-30">
                <SelectTrigger
                  id={props.id}
                  aria-describedby={props["aria-describedby"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-receipt">On receipt</SelectItem>
                  <SelectItem value="net-14">Net 14</SelectItem>
                  <SelectItem value="net-30">Net 30</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            name={scoped("notes")}
            label="Notes"
            description="Only your team sees these."
            className="sm:col-span-2"
          >
            {(props) => <Textarea {...props} rows={3} />}
          </Field>
        </div>

        <Row label="checkbox and switch">
          <span className="flex items-center gap-2">
            <Checkbox id={scoped("gallery-visible")} defaultChecked />
            <Label htmlFor={scoped("gallery-visible")}>
              Visible to the client
            </Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox id={scoped("gallery-unchecked")} />
            <Label htmlFor={scoped("gallery-unchecked")}>Send a reminder</Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox id={scoped("gallery-disabled")} disabled />
            <Label htmlFor={scoped("gallery-disabled")}>Archived</Label>
          </span>
          <span className="flex items-center gap-2">
            <Switch id={scoped("gallery-switch")} defaultChecked />
            <Label htmlFor={scoped("gallery-switch")}>Email on payment</Label>
          </span>
          <span className="flex items-center gap-2">
            <Switch id={scoped("gallery-switch-off")} />
            <Label htmlFor={scoped("gallery-switch-off")}>Weekly digest</Label>
          </span>
        </Row>
      </Section>

      <Section
        id={scoped("address-fields")}
        title="Address fields"
        description="A postal address as one fieldset, first needed for a client's billing address. The two address lines span both columns; the rest sit two to a row."
      >
        <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
          <AddressFields
            legend="Billing address"
            names={{
              line1: scoped("address-line1"),
              line2: scoped("address-line2"),
              city: scoped("address-city"),
              region: scoped("address-region"),
              postalCode: scoped("address-postal-code"),
              country: scoped("address-country"),
            }}
            values={{
              line1: "148 Harbour Street",
              line2: "",
              city: "Halifax",
              region: "Nova Scotia",
              postalCode: "B3J 1V8",
              country: "Canada",
            }}
            fieldErrors={{
              postalCode: ["Use 20 characters or fewer."],
            }}
          />
        </div>
      </Section>

      <Section
        id={scoped("status-chips")}
        title="Status chips"
        description="The word always shows. The tint only reinforces it, so nothing depends on telling one colour from another."
      >
        <Row label="invoice">
          <InvoiceStatusChip status="draft" />
          <InvoiceStatusChip status="sent" />
          <InvoiceStatusChip status="paid" />
          <InvoiceStatusChip status="overdue" />
          <InvoiceStatusChip status="void" />
        </Row>
        <Row label="project">
          <ProjectStatusChip status="planning" />
          <ProjectStatusChip status="in_progress" />
          <ProjectStatusChip status="in_review" />
          <ProjectStatusChip status="delivered" />
        </Row>
        <Row label="deliverable">
          <DeliverableStatusChip status="pending" />
          <DeliverableStatusChip status="ready" />
        </Row>
        <Row label="subscription access (full shows no chip)">
          {Object.entries(SUBSCRIPTION_ACCESS_PRESENTATION).map(
            ([level, { label, tint }]) => (
              <StatusChip key={level} tint={tint}>
                {label}
              </StatusChip>
            ),
          )}
        </Row>
      </Section>

      <Section
        id={scoped("cards,-badges-and-chrome")}
        title="Cards, badges and chrome"
        description="Surfaces that sit above the page, and the small pieces that label them."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Northwind Coffee</CardTitle>
              <CardDescription>
                Four open projects, two overdue invoices.
              </CardDescription>
              <CardAction>
                <Button size="icon-sm" variant="ghost" aria-label="Edit client">
                  <Pencil />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A card holds one thing. Its title is the thing, its description is
              one line about it, and its footer is what you can do to it.
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Open</Button>
              <Button size="sm" variant="outline">
                <Archive />
                Archive
              </Button>
            </CardFooter>
          </Card>

          <div className="flex flex-col gap-4">
            <Row label="badge">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </Row>

            <Row label="avatar">
              <Avatar>
                <AvatarFallback>PR</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>SO</AvatarFallback>
              </Avatar>
            </Row>

            <Row label="breadcrumb">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/clients">Clients</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Northwind Coffee</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </Row>

            <Row label="separator">
              <Separator className="w-full" />
            </Row>

            <Row label="pagination">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      1
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </Row>
          </div>
        </div>
      </Section>

      <Section
        id={scoped("alerts")}
        title="Alerts"
        description="An alert is part of the page. A toast is not, which is why an error is never only a toast."
      >
        <div className="flex flex-col gap-3">
          <Alert>
            <FileText />
            <AlertTitle>Two invoices are overdue</AlertTitle>
            <AlertDescription>
              Northwind Coffee and Ridgeline Fitness have not paid past their
              terms.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <FileText />
            <AlertTitle>This invoice could not be issued</AlertTitle>
            <AlertDescription>
              It has no line items. Add at least one and try again.
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section
        id={scoped("subscription-access")}
        title="Subscription access"
        description="The grace banner sits above every gated page for 7 days after a failed payment; the locked notice opens /billing once the window has closed. Each is a region landmark, and the meaning is in the words and the icon, never the tint alone."
      >
        <div className="flex flex-col gap-3">
          <Row label="grace · admin">
            <div className="w-full">
              <GraceBanner
                graceEndsAt={new Date("2026-09-18T09:05:00Z")}
                role="admin"
              />
            </div>
          </Row>
          <Row label="grace · member">
            <div className="w-full">
              <GraceBanner
                graceEndsAt={new Date("2026-09-18T09:05:00Z")}
                role="member"
              />
            </div>
          </Row>
          <Row label="locked · admin">
            <div className="w-full">
              <LockedNotice role="admin" />
            </div>
          </Row>
          <Row label="locked · member">
            <div className="w-full">
              <LockedNotice role="member" />
            </div>
          </Row>
        </div>
      </Section>

      <Section
        id={scoped("page-header")}
        title="Page header"
        description="One h1 per page, its description under it, its actions to the right."
      >
        <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
          <PageHeader
            title="Invoices"
            description="Everything you have billed, across every client."
            actions={
              <>
                <Button variant="outline" size="sm">
                  <Search />
                  Filter
                </Button>
                <Button size="sm">
                  <Plus />
                  New invoice
                </Button>
              </>
            }
          />
        </div>
      </Section>

      <Section
        id={scoped("table")}
        title="Table"
        description="Below md the low priority columns are gone from the layout and from the accessibility tree. The row is clickable, and each action stays its own tab stop."
      >
        <DataTable
          caption="Invoices, most recent first"
          columns={INVOICE_COLUMNS}
          rows={INVOICE_ROWS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/invoices/${row.id}`}
          rowActions={(row) => (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Edit ${row.number}`}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Archive ${row.number}`}
              >
                <Archive />
              </Button>
            </>
          )}
        />
      </Section>

      <Section
        id={scoped("contacts")}
        title="Client contacts"
        description="The Contacts section of a client page in every invitation status, then empty. The word carries the status; the tint only reinforces it. Controls here are inert stand ins, since the page has no session to act with."
      >
        <div className="flex flex-col gap-4">
          <ContactsSectionView
            headingId={scoped("contacts-heading")}
            clientId={CONTACT_FIXTURES[0].clientId}
            clientName="Northwind Coffee"
            archived={false}
            contacts={CONTACT_FIXTURES}
            addForm={
              <p className="text-xs text-muted-foreground">
                The inline add form (name, email, Add contact) sits here on the
                real page.
              </p>
            }
            actions={(contact) => (
              <div className="flex justify-end gap-1 whitespace-nowrap">
                {contact.status === "accepted" ? undefined : (
                  <Button size="sm" variant="outline" type="button">
                    {contact.status === "not_invited"
                      ? "Send invitation"
                      : contact.status === "unsent"
                        ? "Send again"
                        : "Resend"}
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  type="button"
                  aria-label={`Edit ${contact.name}`}
                >
                  <Pencil />
                </Button>
              </div>
            )}
          />
          <ContactsSectionView
            headingId={scoped("contacts-empty-heading")}
            clientId={CONTACT_FIXTURES[0].clientId}
            clientName="Northwind Coffee"
            archived={false}
            contacts={[]}
            addForm={
              <p className="text-xs text-muted-foreground">
                The inline add form sits here on the real page.
              </p>
            }
          />
        </div>
      </Section>

      <Section
        id={scoped("accept-invitation")}
        title="Accept invitation"
        description="The four states of /portal/accept, with the copy fixed by spec 0009. The wrong account state names only the signed in address, and the invalid state is one sentence for every cause."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {ACCEPT_STATE_FIXTURES.map(({ label, state }) => (
            <div key={label} className="flex flex-col gap-2">
              <p className="font-mono text-xs text-muted-foreground">{label}</p>
              <AcceptInvitationCard
                state={state}
                signOutControl={
                  <Button
                    asChild
                    variant="outline"
                    className="h-auto min-h-9 w-full whitespace-normal"
                  >
                    <Link href="/sign-in">Sign out and switch account</Link>
                  </Button>
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        id={scoped("empty-and-error-states")}
        title="Empty and error states"
        description="Every list has both. The error state never shows a stack trace or a digest, and always offers a way forward."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<Users />}
            heading="No clients yet"
            description="Add the first company you work for and its projects, deliverables and invoices hang off it."
            action={
              <Button>
                <Plus />
                New client
              </Button>
            }
          />
          <ErrorState action={<Button variant="outline">Try again</Button>} />
        </div>
        <EmptyState
          heading="No invoices yet"
          description="Your agency has not issued any invoices to you. This is what an empty state looks like in the client portal: it describes, it does not invite."
        />
      </Section>

      <Section
        id={scoped("loading")}
        title="Loading"
        description="A skeleton is shaped like what replaces it, hidden from assistive technology, and wrapped in a region that announces itself as busy."
      >
        <SkeletonRegion label="Loading invoices">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        </SkeletonRegion>
      </Section>

      <Section
        id={scoped("focus")}
        title="Focus"
        description="One ring for the whole product, declared once in globals.css. Tab through this page and it never changes shape, and never hides under the top bar."
      >
        <p className="text-xs text-muted-foreground">
          Nothing to render here: the proof is the keyboard, and it is the same
          ring on every control above.
        </p>
      </Section>
    </div>
  );
}
