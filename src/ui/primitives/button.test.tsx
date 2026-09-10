import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { Button, buttonVariants } from "./button";

const VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const SIZES = ["default", "sm", "lg", "icon", "icon-sm", "icon-xs"] as const;

describe("Button", () => {
  it("renders a real button element, so it acts like one", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" }).tagName).toBe("BUTTON");
  });

  it("defaults to type button, so it does not submit a form by accident", () => {
    // The HTML default is `submit`. A button that opens a dialog inside a form
    // would otherwise post it.
    render(<Button>Open</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("still accepts an explicit type", () => {
    render(<Button type="submit">Save</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("renders its child instead when asChild is set", () => {
    render(
      <Button asChild>
        <a href="https://example.com">Clients</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Clients" });
    expect(link).toHaveAttribute("href", "https://example.com");
    // No nested button: a link styled as a button is still a link.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not force a type onto the element it renders as", () => {
    render(
      <Button asChild>
        <a href="https://example.com">Clients</a>
      </Button>,
    );

    expect(screen.getByRole("link")).not.toHaveAttribute("type");
  });

  it("calls its handler when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is reachable and operable from the keyboard alone", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  describe("states", () => {
    it("exposes disabled to assistive technology and refuses the click", async () => {
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          Save
        </Button>,
      );

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();

      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("keeps a disabled button readable rather than fading it out", () => {
      // `opacity-50` over a filled button leaves text nobody can read. The
      // disabled look drops to the muted pair instead, which contrast.test.ts
      // measures.
      render(<Button disabled>Save</Button>);

      expect(screen.getByRole("button").className).toContain(
        "disabled:text-muted-foreground",
      );
    });

    it("takes aria-invalid through, so a control can show it is wrong", () => {
      render(<Button aria-invalid>Save</Button>);

      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });

  describe("styling comes only from tokens", () => {
    it.each(VARIANTS)("gives %s no literal colour", (variant) => {
      const classes = buttonVariants({ variant });

      // Invariant 1: every colour comes from the token scale.
      expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(classes).not.toMatch(/\b(rgb|hsl|oklch)\(/);
    });

    it.each(VARIANTS)("gives %s no opacity modifier on a colour", (variant) => {
      // Invariant 11: a faded token is a colour declared nowhere, so the
      // contrast test cannot see it. shadcn ships several of these by default.
      expect(buttonVariants({ variant })).not.toMatch(
        /\b(bg|text|border|ring)-[a-z-]+\/\d+/,
      );
    });

    it("declares no focus ring of its own", () => {
      // One `:focus-visible` rule in globals.css covers the whole product, so a
      // component cannot accidentally ship a weaker one.
      expect(buttonVariants({})).not.toContain("ring-");
    });

    it.each(SIZES)("gives %s a size from the Tailwind scale", (size) => {
      expect(buttonVariants({ size })).toMatch(/\b(h-\d|size-\d)/);
    });
  });

  describe("target size, WCAG 2.2", () => {
    /** The height each size declares, in CSS pixels. Tailwind's unit is 4px. */
    const HEIGHTS: Readonly<Record<(typeof SIZES)[number], number>> = {
      default: 36,
      sm: 32,
      lg: 40,
      icon: 36,
      "icon-sm": 32,
      "icon-xs": 24,
    };

    it.each(SIZES)("declares the height this table claims for %s", (size) => {
      // Binds the table to the real classes, so the floor below is checked
      // against what ships rather than against a number in a test.
      const units = HEIGHTS[size] / 4;

      expect(buttonVariants({ size })).toMatch(
        new RegExp(`(?:^| )(?:h|size)-${units}(?: |$)`),
      );
    });

    it.each(SIZES)("keeps %s at or above the 24 pixel minimum", (size) => {
      // WCAG 2.2, 2.5.8. `icon-xs` sits exactly on it, which is why nothing
      // smaller is offered: there is no room left under it.
      expect(HEIGHTS[size]).toBeGreaterThanOrEqual(24);
    });
  });

  describe.each(THEMES)("in the %s theme", (theme) => {
    it.each(VARIANTS)("has no axe violation as %s", async (variant) => {
      const { container } = render(<Button variant={variant}>Save</Button>);

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    });

    it("has no axe violation when disabled", async () => {
      const { container } = render(<Button disabled>Save</Button>);

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    });
  });
});
