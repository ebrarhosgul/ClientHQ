/**
 * @vitest-environment node
 *
 * The replacement values `scrubUser()` writes, tested without a database. The
 * write itself is an integration concern and is covered against a real
 * PostgreSQL by the data model tests.
 */
import { describe, expect, it } from "vitest";

import { scrubbedUserFields } from "./scrub";

describe("scrubbedUserFields", () => {
  const id = "019a0b6c-0000-7000-8000-000000000001";
  const now = new Date("2026-09-06T12:00:00Z");

  it("replaces the email with a placeholder on the reserved .invalid domain", () => {
    expect(scrubbedUserFields(id, now).email).toBe(`deleted+${id}@invalid`);
  });

  it("keeps the placeholder lowercase, so the email CHECK constraint holds", () => {
    const { email } = scrubbedUserFields(id, now);
    expect(email).toBe(email.toLowerCase());
  });

  it("replaces the name and clears the image", () => {
    const fields = scrubbedUserFields(id, now);
    expect(fields.name).toBe("Deleted user");
    expect(fields.imageUrl).toBeUndefined();
  });

  it("marks the row deleted at the moment given", () => {
    expect(scrubbedUserFields(id, now).deletedAt).toEqual(now);
  });

  it("makes a different placeholder for each user, so two scrubbed users never share one", () => {
    const other = "019a0b6c-0000-7000-8000-000000000002";
    expect(scrubbedUserFields(id, now).email).not.toBe(
      scrubbedUserFields(other, now).email,
    );
  });
});
