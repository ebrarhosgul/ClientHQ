"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { failure, ok, type Result } from "@/db/tenant/errors";

import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, themeChoiceSchema } from "./theme";

/**
 * Store the reader's theme choice.
 *
 * This is the one Server Action in the product that does not go through
 * `withTenantAction()` (spec 0003), and it is deliberate: it touches no tenant
 * row, reads no session and returns nothing about anybody. It is public because
 * `/` is public, and someone who has not signed in still gets to pick a theme.
 *
 * `system` deletes the cookie rather than storing the word, so "no cookie" and
 * "follow the operating system" stay one state (spec 0004).
 */
export async function setThemeAction(theme: unknown): Promise<Result<void>> {
  const parsed = themeChoiceSchema.safeParse(theme);

  if (!parsed.success) {
    // The cookie is left exactly as it was: a bad value changes nothing.
    return failure({ code: "validation", message: "That is not a theme." });
  }

  const jar = await cookies();

  if (parsed.data === "system") {
    jar.delete(THEME_COOKIE);
  } else {
    jar.set(THEME_COOKIE, parsed.data, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THEME_COOKIE_MAX_AGE,
    });
  }

  // Every route reads the cookie in the root layout, so the whole tree is stale.
  revalidatePath("/", "layout");

  return ok(undefined);
}

/**
 * The same action, shaped for `<form action={…}>`.
 *
 * A form action receives `FormData`, and taking it here rather than in
 * `setThemeAction` keeps that function callable with a plain value from a test
 * or from a future client control. The theme buttons carry `name="theme"`, so
 * the clicked one is what arrives, which is what makes the control work with
 * JavaScript switched off (AC-8).
 */
export async function setThemeFormAction(formData: FormData): Promise<void> {
  // The Result is deliberately dropped: a form post has nowhere to render it,
  // and an invalid value here can only come from a hand crafted request, which
  // the action already answers by changing nothing.
  await setThemeAction(formData.get("theme"));
}
