import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const cookieValue = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));
const setThemeFormAction = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "clienthq_theme" && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));

vi.mock("@/ui/theme-action", () => ({ setThemeFormAction }));

const { ThemeControl } = await import("./theme-control");

/** The control is an async server component, so it is awaited then rendered. */
async function renderControl() {
  return render(await ThemeControl({}));
}

beforeEach(() => {
  cookieValue.current = undefined;
});

describe("the theme control", () => {
  it("is a labelled group, so its three buttons are announced together", async () => {
    await renderControl();

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });

  it("offers System, Light and Dark", async () => {
    await renderControl();

    for (const label of ["System", "Light", "Dark"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("names each button, even though each shows only an icon", async () => {
    await renderControl();

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAccessibleName();
    }
  });

  it("marks System as the current choice when there is no cookie", async () => {
    await renderControl();

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it.each(["light", "dark"] as const)(
    "marks %s as the current choice when the cookie says so",
    async (theme) => {
      cookieValue.current = theme;
      await renderControl();

      const label = theme === "light" ? "Light" : "Dark";
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    },
  );

  it("marks exactly one choice as current", async () => {
    cookieValue.current = "dark";
    await renderControl();

    const pressed = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");

    expect(pressed).toHaveLength(1);
  });

  it("reads the cookie itself rather than trusting a caller", async () => {
    // A caller passing a stale value would render the control out of step with
    // the palette the root layout stamped on the document.
    cookieValue.current = "dark";
    await renderControl();

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  describe("working without JavaScript", () => {
    it("posts a real form to the Server Action", async () => {
      const { container } = await renderControl();

      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      // Next.js gives a Server Action form a real action attribute, which is
      // what a browser with scripting off submits.
      expect(form?.tagName).toBe("FORM");
    });

    it("carries the choice on each button, so the clicked one is submitted", async () => {
      const { container } = await renderControl();
      const form = container.querySelector("form");

      const submitted = within(form as HTMLElement)
        .getAllByRole("button")
        .map((button) => [
          button.getAttribute("name"),
          button.getAttribute("value"),
        ]);

      expect(submitted).toEqual([
        ["theme", "system"],
        ["theme", "light"],
        ["theme", "dark"],
      ]);
    });

    it("makes every button a submit button", async () => {
      await renderControl();

      for (const button of screen.getAllByRole("button")) {
        expect(button).toHaveAttribute("type", "submit");
      }
    });
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = await renderControl();

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
