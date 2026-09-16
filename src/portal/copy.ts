/**
 * Every pinned string the portal shows, held once so the pages, the
 * unavailable page and the not found page cannot drift from the spec's exact
 * wording (spec 0014, AC-3, AC-5, AC-7, AC-8, AC-9, AC-11, AC-12).
 *
 * Filled in as each build task lands rather than all at once, so an unused
 * constant never sits here waiting for a page that does not exist yet.
 */

/** AC-3: the page a locked or unsubscribed agency's contact sees. */
export function unavailableCopy(agencyName: string) {
  return {
    heading: "This portal is not available right now",
    body: `${agencyName}'s ClientHQ account needs attention before the portal can be shown. Contact ${agencyName} if you need something in the meantime.`,
  } as const;
}

/**
 * AC-5, AC-6: the overview's Projects block and `/portal/projects`'s empty
 * state, the same text in both places by construction.
 */
export const OVERVIEW_PROJECTS_EMPTY = {
  heading: "No projects yet",
  description: "Your agency has not started a project for you.",
} as const;

/**
 * AC-5, AC-8: the overview's Files block and `/portal/files`'s empty state,
 * the same text in both places by construction.
 */
export const OVERVIEW_FILES_EMPTY = {
  heading: "No files shared yet",
  description: "Your agency has not shared any files with you.",
} as const;

/** AC-11: shown in the switcher menu when a chosen row is refused. */
export const SWITCH_REFUSED = "That client is no longer available to you.";

/** AC-5: the overview's Invoices block, capped to the unpaid rows. */
export const OVERVIEW_INVOICES_EMPTY = {
  heading: "No invoices awaiting payment",
  description:
    "Your agency has not issued an invoice that is awaiting payment.",
} as const;

/** AC-9: the full `/portal/invoices` list, every client visible status. */
export const INVOICES_LIST_EMPTY = {
  heading: "No invoices yet",
  description: "Your agency has not issued an invoice to you.",
} as const;
