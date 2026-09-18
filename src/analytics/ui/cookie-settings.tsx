"use client";

/**
 * The way back to the banner (spec 0019, AC-18): clears the consent cookie
 * so the page asks again, with no reload. Rendered as a button on `/privacy`
 * and as a menu item in the user menu, from the same hook.
 */
import { useTransition } from "react";

import { Button } from "@/ui/primitives/button";
import { DropdownMenuItem } from "@/ui/primitives/dropdown-menu";

import { setCookieConsent } from "../consent";
import { useConsent } from "../consent-context";

function useResetConsent(): {
  readonly reset: () => void;
  readonly pending: boolean;
} {
  const { setConsent } = useConsent();
  const [pending, startTransition] = useTransition();

  const reset = () => {
    startTransition(async () => {
      const result = await setCookieConsent("undecided");

      if (result.ok) {
        setConsent("undecided");
      }
    });
  };

  return { reset, pending };
}

export function CookieSettingsButton() {
  const { reset, pending } = useResetConsent();

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={reset}>
      Cookie settings
    </Button>
  );
}

export function CookieSettingsMenuItem() {
  const { reset } = useResetConsent();

  return <DropdownMenuItem onSelect={reset}>Cookie settings</DropdownMenuItem>;
}
