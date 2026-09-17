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
 * **A later agency settings feature replaces this file** (agency name and
 * default currency). Spec 0015 built `/team` and deliberately left this one.
 */
export default function SettingsPlaceholder(): never {
  notFound();
}
