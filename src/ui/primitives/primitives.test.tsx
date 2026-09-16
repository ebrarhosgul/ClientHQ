import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { act } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Label } from "./label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "./pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Separator } from "./separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { Toaster } from "./sonner";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

/**
 * jsdom implements neither. Radix Select's hidden native `<select>` measures
 * itself with a `ResizeObserver`, and its trigger checks pointer capture on
 * open; both are real browser APIs the layout engine never runs here, so they
 * are stubbed rather than the interactions they gate being left untested.
 */
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof window.HTMLElement.prototype.hasPointerCapture === "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}
if (typeof window.HTMLElement.prototype.scrollIntoView === "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

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

  it("keeps its content track bounded, so a field-sizing-content child cannot blow it out", async () => {
    // A bare `grid` on the content box gives its one implicit column an
    // `auto` track, which grows to fit the widest child instead of
    // respecting the dialog's own max-width. A `field-sizing-content`
    // textarea holding one long, unbroken word (spec 0012's void reason,
    // AC-9) then balloons past the dialog and off screen. `grid-cols-1`
    // makes that track `minmax(0, 1fr)`, which is what actually clamps it.
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this invoice?</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("dialog").className).toMatch(/\bgrid-cols-1\b/);
  });
});

describe("the sheet", () => {
  it("opens, names itself and returns focus to its trigger on close", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit client</SheetTitle>
            <SheetDescription>
              Changes save when you close this.
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const dialog = screen.getByRole("dialog", { name: "Edit client" });
    expect(dialog).toHaveAccessibleDescription(
      "Changes save when you close this.",
    );

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("names its close button by default, and can hide it entirely", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent showCloseButton={false}>
          <SheetHeader>
            <SheetTitle>Edit client</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation while open, in the %s theme",
    async (theme) => {
      const user = userEvent.setup();

      render(
        <Sheet>
          <SheetTrigger>Open</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Edit client</SheetTitle>
              <SheetDescription>
                Changes save when you close this.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>,
      );

      await user.click(screen.getByRole("button", { name: "Open" }));

      await withTheme(theme, () =>
        expectNoAccessibilityViolations(document.body),
      );
    },
  );
});

describe("the tooltip", () => {
  it("names itself for whoever is pointing at the trigger", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Archive</TooltipTrigger>
          <TooltipContent>
            Moves the client out of the active list.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Moves the client out of the active list.",
    );
  });

  it("closes on Escape, for someone who never touched a pointer", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Archive</TooltipTrigger>
          <TooltipContent>
            Moves the client out of the active list.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Archive" });
    await user.hover(trigger);
    await screen.findByRole("tooltip");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it.each(THEMES)(
    "has no axe violation while open, in the %s theme",
    async (theme) => {
      const user = userEvent.setup();

      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Archive</TooltipTrigger>
            <TooltipContent>
              Moves the client out of the active list.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );

      await user.hover(screen.getByRole("button", { name: "Archive" }));
      await screen.findByRole("tooltip");

      await withTheme(theme, () =>
        expectNoAccessibilityViolations(document.body),
      );
    },
  );
});

describe("the select", () => {
  it("opens, lets an option be chosen and reports the new value", async () => {
    const user = userEvent.setup();

    render(
      <Select defaultValue="draft">
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="sent">Sent</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Status" });
    await user.click(trigger);

    const option = await screen.findByRole("option", { name: "Sent" });
    await user.click(option);

    expect(trigger).toHaveTextContent("Sent");
  });

  it("keeps a disabled trigger unopenable", async () => {
    const user = userEvent.setup();

    render(
      <Select defaultValue="draft">
        <SelectTrigger aria-label="Status" disabled>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="draft">Draft</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Status" });
    expect(trigger).toBeDisabled();

    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation closed, in the %s theme",
    async (theme) => {
      const { container } = render(
        <Select defaultValue="draft">
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});

describe("the dropdown menu", () => {
  it("opens on click and lets an item be chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));

    const item = await screen.findByRole("menuitem", { name: "Archive" });
    await user.click(item);

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
  });

  it.each(THEMES)(
    "has no axe violation while open, in the %s theme",
    async (theme) => {
      const user = userEvent.setup();

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );

      await user.click(screen.getByRole("button", { name: "Actions" }));
      await screen.findByRole("menu");

      await withTheme(theme, () =>
        expectNoAccessibilityViolations(document.body),
      );
    },
  );
});

describe("the toaster", () => {
  it("mounts with no toast raised yet without violating anything", async () => {
    const { container } = render(<Toaster />);

    await expectNoAccessibilityViolations(container);
  });

  it("surfaces a toast raised elsewhere in the app", async () => {
    render(<Toaster />);

    act(() => {
      toast.success("Client saved");
    });

    expect(await screen.findByText("Client saved")).toBeInTheDocument();
  });
});
