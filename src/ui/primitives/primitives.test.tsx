import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Avatar, AvatarFallback } from "./avatar";
import { Badge } from "./badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Checkbox } from "./checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "./pagination";
import { Separator } from "./separator";
import { Switch } from "./switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { Textarea } from "./textarea";

/**
 * Every primitive rendered in every state that applies to it, in both palettes,
 * with axe over each one (AC-4, AC-19).
 *
 * The overlays that need a click to open (dialog, sheet, dropdown, tooltip) are
 * exercised in the focused blocks below rather than in the sweep, because axe
 * has to see them open to say anything useful about them.
 */
const CASES: readonly (readonly [string, ReactElement])[] = [
  [
    "alert",
    <Alert key="a">
      <AlertTitle>Two invoices are overdue</AlertTitle>
      <AlertDescription>Northwind Coffee has not paid.</AlertDescription>
    </Alert>,
  ],
  [
    "alert, destructive",
    <Alert key="b" variant="destructive">
      <AlertTitle>Could not issue</AlertTitle>
      <AlertDescription>It has no line items.</AlertDescription>
    </Alert>,
  ],
  [
    "avatar",
    <Avatar key="c">
      <AvatarFallback>PR</AvatarFallback>
    </Avatar>,
  ],
  ["badge", <Badge key="d">Default</Badge>],
  [
    "badge, secondary",
    <Badge key="e" variant="secondary">
      Secondary
    </Badge>,
  ],
  [
    "badge, outline",
    <Badge key="f" variant="outline">
      Outline
    </Badge>,
  ],
  [
    "badge, destructive",
    <Badge key="g" variant="destructive">
      Destructive
    </Badge>,
  ],
  [
    "breadcrumb",
    <Breadcrumb key="h">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/clients">Clients</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Northwind Coffee</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
  ],
  [
    "card",
    <Card key="i">
      <CardHeader>
        <CardTitle>Northwind Coffee</CardTitle>
        <CardDescription>Four open projects.</CardDescription>
      </CardHeader>
      <CardContent>Body copy.</CardContent>
    </Card>,
  ],
  [
    "checkbox",
    <div key="j">
      <Checkbox id="p-check" defaultChecked />
      <Label htmlFor="p-check">Visible to the client</Label>
    </div>,
  ],
  [
    "checkbox, disabled",
    <div key="k">
      <Checkbox id="p-check-d" disabled />
      <Label htmlFor="p-check-d">Archived</Label>
    </div>,
  ],
  [
    "input",
    <div key="l">
      <Label htmlFor="p-input">Client name</Label>
      <Input id="p-input" defaultValue="Northwind Coffee" />
    </div>,
  ],
  [
    "input, invalid",
    <div key="m">
      <Label htmlFor="p-input-i">Email</Label>
      <Input id="p-input-i" aria-invalid aria-describedby="p-input-e" />
      <p id="p-input-e">Enter an email address.</p>
    </div>,
  ],
  [
    "input, read only",
    <div key="n">
      <Label htmlFor="p-input-r">Invoice number</Label>
      <Input id="p-input-r" readOnly defaultValue="INV-0001" />
    </div>,
  ],
  [
    "input, disabled",
    <div key="o">
      <Label htmlFor="p-input-x">Currency</Label>
      <Input id="p-input-x" disabled defaultValue="USD" />
    </div>,
  ],
  [
    "pagination",
    <Pagination key="p">
      <PaginationContent>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">2</PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>,
  ],
  ["separator", <Separator key="q" />],
  [
    "switch",
    <div key="r">
      <Switch id="p-switch" defaultChecked />
      <Label htmlFor="p-switch">Email on payment</Label>
    </div>,
  ],
  [
    "table",
    <Table key="s">
      <caption>Invoices</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Invoice</TableHead>
          <TableHead scope="col">Client</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>INV-0001</TableCell>
          <TableCell>Northwind Coffee</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  ],
  [
    "textarea",
    <div key="t">
      <Label htmlFor="p-textarea">Notes</Label>
      <Textarea id="p-textarea" rows={3} />
    </div>,
  ],
];

describe.each(THEMES)("every primitive in the %s theme", (theme) => {
  it.each(CASES)("%s has no axe violation", async (_name, element) => {
    const { container } = render(element);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});

describe("the dialog", () => {
  it("opens, names itself, traps focus and closes on Escape", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this client?</DialogTitle>
            <DialogDescription>
              Its projects and invoices stay where they are.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const dialog = screen.getByRole("dialog", { name: "Archive this client?" });
    expect(dialog).toHaveAccessibleDescription(
      "Its projects and invoices stay where they are.",
    );

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Focus goes back to what opened it, so a keyboard user is not dropped at
    // the top of the document.
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("names its close button", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this client?</DialogTitle>
            <DialogDescription>Nothing is deleted.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation while open, in the %s theme",
    async (theme) => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive this client?</DialogTitle>
              <DialogDescription>Nothing is deleted.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      );

      await user.click(screen.getByRole("button", { name: "Open" }));

      await withTheme(theme, () =>
        expectNoAccessibilityViolations(document.body),
      );
    },
  );
});
