import { notFound } from "next/navigation";

/**
 * `/settings`, reserved.
 *
 * The sidebar links to every path this product commits to (AC-23), including
 * the ones still to be built. This page keeps that honest: it hands off to the
 * route group's `not-found.tsx`, so the link lands inside the shell with an
 * explanation and a way back rather than on a bare 404, and the response is
 * still a real 404 rather than a page pretending the section exists.
 *
 * **Feature 16, "Team members & roles", replaces this file.**
 */
export default function SettingsPlaceholder(): never {
  notFound();
}
