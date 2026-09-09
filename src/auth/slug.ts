/**
 * The agency slug, derived in one place.
 *
 * Both agency creation and the mirror repair call this, and neither ever reads
 * the slug Clerk stored. That is deliberate (spec 0005, AC-10): after a
 * collision race the local slug and Clerk's can differ, which is harmless
 * because spec 0001 fixed that no slug appears in a URL, whereas *copying*
 * Clerk's value would make the repair retry the identical unique violation it
 * is there to heal, forever.
 *
 * Pure on purpose: the set of slugs already taken is passed in, so the query
 * that reads `organizations.slug` stays inside the tenant layer and this file
 * stays trivially testable.
 */

/**
 * The slug for a name with nothing taken.
 *
 * Lowercased, accents dropped, every run of non alphanumeric characters
 * collapsed to a single `-`, and trimmed at both ends.
 */
export function toSlug(name: string): string {
  const derived = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  // A name made entirely of punctuation or of a script that leaves nothing
  // behind ("+++", "北京") derives to an empty string, and the column is not
  // null. Nothing reads the slug, so any stable word will do; the suffixing
  // below is what keeps it unique.
  return derived === "" ? "agency" : derived;
}

/**
 * The first free slug for this name, given the ones already in use.
 *
 * `taken` is every slug that could collide: the derived base and anything of
 * the shape `<base>-<n>`. Among `taken.size + 1` distinct candidates at least
 * one is free, so the search always terminates.
 */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = toSlug(name);

  const candidates = [
    base,
    ...Array.from({ length: taken.size }, (_, index) => `${base}-${index + 2}`),
  ];

  const free = candidates.find((candidate) => !taken.has(candidate));

  if (free === undefined) {
    // Unreachable: more candidates were generated than `taken` can hold.
    throw new Error(`No free slug for "${name}" among ${taken.size} taken.`);
  }

  return free;
}
