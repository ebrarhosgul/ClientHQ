/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-5, AC-6
 *
 * The write through touches exactly one `memberships` row, found by the
 * Clerk user id through the scoped accessor, and never the `users` row.
 */
import { describe, expect, it, vi } from "vitest";

import { memberships } from "@/db/schema";
import type { StaffAccessor } from "@/db/tenant";

import { deleteMirrorMembership, updateMirrorRole } from "./mirror";

function accessor(rows: ReadonlyArray<{ id: string; clerkUserId: string }>) {
  const db = {
    findMany: vi.fn().mockResolvedValue(
      rows.map((row) => ({
        id: row.id,
        user: { clerkUserId: row.clerkUserId },
      })),
    ),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(true),
  };

  return { db, as: db as unknown as StaffAccessor };
}

describe("updateMirrorRole", () => {
  it("updates the row whose user carries the Clerk id", async () => {
    const { db, as } = accessor([
      { id: "m1", clerkUserId: "user_a" },
      { id: "m2", clerkUserId: "user_b" },
    ]);

    await updateMirrorRole(as, "user_b", "admin");

    expect(db.findMany).toHaveBeenCalledWith(memberships, {
      with: { user: { columns: { clerkUserId: true } } },
    });
    expect(db.update).toHaveBeenCalledWith(memberships, "m2", {
      role: "admin",
    });
  });

  it("writes nothing when the person has no mirror row yet", async () => {
    const { db, as } = accessor([{ id: "m1", clerkUserId: "user_a" }]);

    await updateMirrorRole(as, "user_never_visited", "admin");

    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("deleteMirrorMembership", () => {
  it("deletes only the memberships row, by its id", async () => {
    const { db, as } = accessor([{ id: "m1", clerkUserId: "user_a" }]);

    await deleteMirrorMembership(as, "user_a");

    expect(db.delete).toHaveBeenCalledWith(memberships, "m1");
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes nothing when there is no row", async () => {
    const { db, as } = accessor([]);

    await deleteMirrorMembership(as, "user_a");

    expect(db.delete).not.toHaveBeenCalled();
  });
});
