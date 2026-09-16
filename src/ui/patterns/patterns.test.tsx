import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ACTION_ERROR_CODES } from "@/db/tenant/errors";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";
import { Button } from "@/ui/primitives/button";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

import { AddressFields } from "./address-fields";
import { BrandMark, Wordmark } from "./brand";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type Column } from "./data-table";
import { EmptyState } from "./empty-state";
import { errorMessage, messageForCode } from "./error-messages";
import { DEFAULT_ERROR_HEADING, ErrorState } from "./error-state";
import { PageHeader } from "./page-header";

const ADDRESS_NAMES = {
  line1: "billingAddressLine1",
  line2: "billingAddressLine2",
  city: "billingCity",
  region: "billingRegion",
  postalCode: "billingPostalCode",
  country: "billingCountry",
};

const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
};

type Row = {
  readonly id: string;
  readonly number: string;
  readonly client: string;
};

const ROWS: readonly Row[] = [
  { id: "1", number: "INV-0001", client: "Northwind Coffee" },
  { id: "2", number: "INV-0002", client: "Harbour Books" },
];

const COLUMNS: readonly Column<Row>[] = [
  {
    key: "number",
    header: "Invoice",
    priority: "high",
    identifying: true,
    cell: (row) => row.number,
  },
  {
    key: "client",
    header: "Client",
    priority: "low",
    cell: (row) => row.client,
  },
];

describe("EmptyState", () => {
  it("says what is missing and what to do about it", () => {
    render(
      <EmptyState
        heading="No clients yet"
        description="Add the first company you work for."
        action={<Button>New client</Button>}
      />,
    );

    expect(screen.getByText("No clients yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add the first company you work for."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New client" }),
    ).toBeInTheDocument();
  });

  it("works with no action, which is what the read only portal needs", () => {
    render(
      <EmptyState
        heading="No invoices yet"
        description="Nothing has been issued."
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides a decorative icon from assistive technology", () => {
    const { container } = render(
      <EmptyState
        heading="No clients yet"
        description="Nothing here."
        icon={<svg data-testid="icon" />}
      />,
    );

    expect(container.querySelector("[aria-hidden]")).toContainElement(
      screen.getByTestId("icon"),
    );
  });
});

describe("ErrorState", () => {
  it("announces itself, for someone reading elsewhere on the page", () => {
    render(<ErrorState />);

    expect(screen.getByRole("alert")).toHaveTextContent(DEFAULT_ERROR_HEADING);
  });

  it("offers a way forward", () => {
    render(<ErrorState action={<Button>Try again</Button>} />);

    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("takes its own words for a case that is not a fault", () => {
    render(
      <ErrorState
        heading="Page not found"
        description="This address does not lead anywhere."
      />,
    );

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});

describe("error messages", () => {
  it.each(ACTION_ERROR_CODES)("has a plain sentence for %s", (code) => {
    const message = messageForCode(code);

    expect(message).toMatch(/^[A-Z].*[.!?]$/);
  });

  it.each(ACTION_ERROR_CODES)("names no table or driver in %s", (code) => {
    // A person should learn what happened, not the shape of the database.
    expect(messageForCode(code)).not.toMatch(
      /postgres|drizzle|constraint|sql|org_id|null|undefined/i,
    );
  });

  it("prefers the handler's own message when it has one", () => {
    expect(
      errorMessage({
        code: "conflict",
        message: "That invoice number is taken.",
      }),
    ).toBe("That invoice number is taken.");
  });

  it("falls back to the map when the message is blank", () => {
    expect(errorMessage({ code: "forbidden", message: "   " })).toBe(
      messageForCode("forbidden"),
    );
  });
});

describe("PageHeader", () => {
  it("gives the page its one first level heading", () => {
    render(<PageHeader title="Invoices" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Invoices" }),
    ).toBeInTheDocument();
  });

  it("carries its actions", () => {
    render(
      <PageHeader title="Invoices" actions={<Button>New invoice</Button>} />,
    );

    expect(
      screen.getByRole("button", { name: "New invoice" }),
    ).toBeInTheDocument();
  });

  it("lets a multi button actions group shrink instead of overflowing", () => {
    render(
      <PageHeader
        title="INV-0004"
        actions={
          <>
            <Button>Mark paid</Button>
            <Button>Resend notification</Button>
            <Button>Void</Button>
          </>
        }
      />,
    );

    const actionsGroup = screen.getByRole("button", {
      name: "Mark paid",
    }).parentElement;

    // A `shrink-0` actions wrapper keeps its max content width even once
    // `PageHeader`'s own row has wrapped the actions onto their own line,
    // which is what overflowed the viewport at 320px (spec 0012, AC-17).
    expect(actionsGroup?.className).not.toMatch(/\bshrink-0\b/);
  });
});

describe("DataTable", () => {
  it("names the table for a screen reader", () => {
    render(
      <DataTable
        caption="Invoices, most recent first"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    expect(
      screen.getByRole("table", { name: "Invoices, most recent first" }),
    ).toBeInTheDocument();
  });

  it("marks its header cells as column headers", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  it("hides a low priority column below md, in the layout and the tree together", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    // `hidden md:table-cell` is `display: none` under the breakpoint, which is
    // what takes it out of the accessibility tree too.
    const client = screen.getByRole("columnheader", { name: "Client" });
    expect(client.className).toContain("hidden");
    expect(client.className).toContain("md:table-cell");
  });

  it("leaves a high priority column at every width", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "Invoice" }).className,
    ).not.toContain("hidden");
  });

  it("puts one link in the row rather than wrapping the row", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowHref={(row) => `/invoices/${row.id}`}
      />,
    );

    // A `<tr>` cannot wrap an `<a>`, and a row link containing buttons is a
    // nested interactive control. The identifying cell's link is stretched
    // instead.
    const link = screen.getByRole("link", { name: "INV-0001" });
    expect(link).toHaveAttribute("href", "/invoices/1");
    expect(link.className).toContain("after:absolute");
    expect(link.closest("tr")?.tagName).toBe("TR");
  });

  it("keeps each row action separately reachable and separately named", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowHref={(row) => `/invoices/${row.id}`}
        rowActions={(row) => (
          <Button size="icon-sm" aria-label={`Archive ${row.number}`}>
            <svg />
          </Button>
        )}
      />,
    );

    // Named per row, not "Archive" five times over.
    expect(
      screen.getByRole("button", { name: "Archive INV-0001" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Archive INV-0002" }),
    ).toBeInTheDocument();
  });

  it("lifts the actions cell above the stretched link", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowHref={(row) => `/invoices/${row.id}`}
        rowActions={() => <Button aria-label="Archive">x</Button>}
      />,
    );

    const cell = screen
      .getAllByRole("button", { name: "Archive" })[0]
      .closest("td");

    // Without its own stacking context the buttons sit under the row link and
    // become unclickable.
    expect(cell?.className).toContain("z-10");
  });

  it("gives the actions column a header a screen reader can hear", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowActions={() => <Button aria-label="Archive">x</Button>}
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    expect(
      within(headers[headers.length - 1]).getByText("Actions"),
    ).toBeInTheDocument();
  });

  it("right aligns and tabulates a numeric column, so figures line up", () => {
    render(
      <DataTable
        caption="Invoices"
        columns={[
          {
            key: "n",
            header: "Amount",
            priority: "high",
            align: "end",
            cell: () => "1,000.00",
          },
        ]}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    expect(screen.getAllByRole("cell")[0].className).toContain("tabular-nums");
  });
});

describe("brand", () => {
  it("hides the decorative mark from assistive technology", () => {
    const { container } = render(<BrandMark />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("leaves the icon out of what a screen reader reads, so only the word remains", () => {
    const { container } = render(<Wordmark />);

    // The mark is aria-hidden, so "ClientHQ" is the only text a screen
    // reader has to announce here, not the icon and the word both.
    expect(screen.getByText("ClientHQ")).toBeInTheDocument();
    expect(container.textContent).toBe("ClientHQ");
  });
});

describe("AddressFields", () => {
  it("names the group with its legend, spec 0006", () => {
    render(
      <AddressFields
        legend="Billing address"
        names={ADDRESS_NAMES}
        values={EMPTY_ADDRESS}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Billing address" }),
    ).toBeInTheDocument();
  });

  it("labels all six sub-fields", () => {
    render(
      <AddressFields
        legend="Billing address"
        names={ADDRESS_NAMES}
        values={EMPTY_ADDRESS}
      />,
    );

    for (const label of [
      "Address line 1",
      "Address line 2",
      "City",
      "State or province",
      "Postal code",
      "Country",
    ]) {
      expect(screen.getByRole("textbox", { name: label })).toBeInTheDocument();
    }
  });

  it("prefills each sub-field from values", () => {
    render(
      <AddressFields
        legend="Billing address"
        names={ADDRESS_NAMES}
        values={{ ...EMPTY_ADDRESS, city: "Portland", country: "USA" }}
      />,
    );

    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue(
      "Portland",
    );
    expect(screen.getByRole("textbox", { name: "Country" })).toHaveValue("USA");
  });

  it("shows a field error beside its own sub-field, not the others", () => {
    render(
      <AddressFields
        legend="Billing address"
        names={ADDRESS_NAMES}
        values={EMPTY_ADDRESS}
        fieldErrors={{ postalCode: ["Use 20 characters or fewer."] }}
      />,
    );

    expect(screen.getByText("Use 20 characters or fewer.")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Postal code" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "City" })).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});

describe("ConfirmDialog", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("stays closed until the trigger is activated", () => {
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={async () => ({ ok: true })}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the trigger, naming itself from title and description", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={async () => ({ ok: true })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("dialog", { name: "Archive Acme?" });
    expect(dialog).toHaveAccessibleDescription("Nothing is deleted.");
  });

  it("cancels without ever calling onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => ({ ok: true }));
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes itself once onConfirm succeeds", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={async () => ({ ok: true })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the message when onConfirm fails", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={async () => ({ ok: false, message: "That did not work." })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That did not work.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables Cancel while the confirm action is pending, then closes once it resolves", async () => {
    const user = userEvent.setup();
    const { promise, resolve } = deferred<{ ok: boolean }>();
    render(
      <ConfirmDialog
        trigger={<Button>Archive</Button>}
        title="Archive Acme?"
        description="Nothing is deleted."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        onConfirm={() => promise}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(
      await within(dialog).findByRole("button", { name: "Archiving…" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();

    resolve({ ok: true });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it.each(THEMES)(
    "has no axe violation while open, in the %s theme",
    async (theme) => {
      const user = userEvent.setup();
      const { container } = render(
        <ConfirmDialog
          trigger={<Button>Archive</Button>}
          title="Archive Acme?"
          description="Nothing is deleted."
          confirmLabel="Archive"
          variant="destructive"
          onConfirm={async () => ({ ok: true })}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Archive" }));

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});

describe("skeletons", () => {
  it("hides the shapes from assistive technology", () => {
    render(<Skeleton data-testid="shape" className="h-4 w-20" />);

    expect(screen.getByTestId("shape")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the region as busy instead", () => {
    render(
      <SkeletonRegion label="Loading invoices">
        <Skeleton className="h-4 w-20" />
      </SkeletonRegion>,
    );

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Loading invoices");
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation across the patterns", async () => {
    const { container } = render(
      <div>
        <Wordmark />
        <PageHeader
          title="Invoices"
          description="Everything you have billed."
        />
        <DataTable
          caption="Invoices"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/invoices/${row.id}`}
          rowActions={(row) => (
            <Button size="icon-sm" aria-label={`Archive ${row.number}`}>
              <svg />
            </Button>
          )}
        />
        <EmptyState heading="No clients yet" description="Nothing here." />
        <ErrorState />
        <AddressFields
          legend="Billing address"
          names={ADDRESS_NAMES}
          values={EMPTY_ADDRESS}
        />
        <SkeletonRegion label="Loading">
          <Skeleton className="h-4 w-20" />
        </SkeletonRegion>
      </div>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
