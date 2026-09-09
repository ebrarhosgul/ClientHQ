import { Monitor, Moon, Sun } from "lucide-react";
import { cookies } from "next/headers";
import type { ComponentType } from "react";

import { cn } from "@/ui/lib/cn";
import { setThemeFormAction } from "@/ui/theme-action";
import {
  readStoredTheme,
  THEME_CHOICES,
  THEME_COOKIE,
  THEME_LABELS,
  type ThemeChoice,
} from "@/ui/theme";

const ICONS: Readonly<
  Record<ThemeChoice, ComponentType<{ className?: string }>>
> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * System, Light, Dark.
 *
 * A plain form with three submit buttons, so it works with no JavaScript at
 * all: the clicked button's `name` and `value` are what the browser posts, the
 * Server Action writes the cookie, and the page comes back painted in the new
 * theme (AC-8). Nothing here runs in the browser.
 *
 * The current choice is read from the cookie rather than passed in, so a caller
 * cannot render the control out of step with the document the root layout
 * stamped.
 *
 * `aria-pressed` rather than a radio group: each button performs an action
 * immediately, which is a toggle, not a value waiting for a submit. Each is 28
 * square, over the 24 pixel minimum in WCAG 2.2 (AC-21).
 */
export async function ThemeControl({
  className,
}: {
  readonly className?: string;
}) {
  const current: ThemeChoice =
    readStoredTheme((await cookies()).get(THEME_COOKIE)?.value) ?? "system";

  return (
    <form action={setThemeFormAction}>
      <div
        role="group"
        aria-label="Theme"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5",
          className,
        )}
      >
        {THEME_CHOICES.map((choice) => {
          const Icon = ICONS[choice];
          const active = choice === current;

          return (
            <button
              key={choice}
              type="submit"
              name="theme"
              value={choice}
              aria-pressed={active}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-sm transition-surface",
                active
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-secondary-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="sr-only">{THEME_LABELS[choice]}</span>
            </button>
          );
        })}
      </div>
    </form>
  );
}
