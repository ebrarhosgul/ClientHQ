"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { Wordmark } from "@/ui/patterns/brand";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/primitives/sheet";

import { SidebarNav } from "./sidebar-nav";

/**
 * The sidebar, below the `md` breakpoint.
 *
 * Radix's `Sheet` is what handles the three things AC-7 asks for and that are
 * genuinely hard to hand roll: focus stays inside while it is open, `Escape`
 * closes it, and focus returns to the button that opened it.
 *
 * Closing on navigation is this component's own job. Without it, tapping a link
 * changes the page behind a sheet that is still covering it.
 */
export function MobileNavSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-9 items-center justify-center rounded-md text-foreground transition-surface hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Open the menu"
      >
        <Menu aria-hidden className="size-5" />
      </SheetTrigger>

      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle asChild>
            <span>
              <Wordmark />
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto p-3">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
