/**
 * @vitest-environment node
 *
 * covers: spec 0006 AC-8, AC-9
 *
 * `withTenantAction` itself is proven in `src/db/tenant/action.test.ts`; this
 * file exercises the idempotency both actions promise: archiving an already
 * archived client, and restoring an already active one, succeed with no
 * error and no write, rather than treating "already in that state" as a
 * failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/tenant", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction:
      (config: {
        readonly input: { safeParse: (value: unknown) => never };
        readonly handler: (args: {
          readonly input: unknown;
          readonly ctx: unknown;
          readonly db: unknown;
        }) => Promise<unknown>;
      }) =>
      async (rawInput: unknown) => {
        const parsed = config.input.safeParse(rawInput) as
          | { success: true; data: unknown }
          | {
              success: false;
              error: { flatten: () => { fieldErrors: unknown } };
            };

        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "validation",
              message: "Some of that is not right yet.",
              fieldErrors: parsed.error.flatten().fieldErrors,
            },
          };
        }

        try {
          const data = await config.handler({
            input: parsed.data,
            ctx: { orgId: "org-1" },
            db: { findById: state.findById, update: state.update },
          });

          return { ok: true, data };
        } catch (thrown) {
          if (actual.isTenantActionError(thrown)) {
            return { ok: false, error: thrown.error };
          }

          throw thrown;
        }
      },
  };
});

const { archiveClient, restoreClient } = await import("./archive-client");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("archiveClient", () => {
  it("returns not_found for a missing id, the same outcome a foreign agency's id gets", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await archiveClient({ id: "nope" });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("archives an active client, setting archived_at", async () => {
    state.findById.mockResolvedValue({ id: "c1", archivedAt: null });
    const archivedAt = new Date("2026-01-01T00:00:00.000Z");
    state.update.mockResolvedValue({ id: "c1", archivedAt });

    const result = await archiveClient({ id: "c1" });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });

  it("succeeds with no write when the client is already archived (AC-8)", async () => {
    const archivedAt = new Date("2025-06-01T00:00:00.000Z");
    state.findById.mockResolvedValue({ id: "c1", archivedAt });

    const result = await archiveClient({ id: "c1" });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });

  it("returns not_found if the row disappears between the read and the write", async () => {
    state.findById.mockResolvedValue({ id: "c1", archivedAt: null });
    state.update.mockResolvedValue(undefined);

    const result = await archiveClient({ id: "c1" });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });
});

describe("restoreClient", () => {
  it("returns not_found for a missing id", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await restoreClient({ id: "nope" });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("restores an archived client, clearing archived_at", async () => {
    state.findById.mockResolvedValue({
      id: "c1",
      archivedAt: new Date("2025-06-01T00:00:00.000Z"),
    });
    state.update.mockResolvedValue({ id: "c1", archivedAt: null });

    const result = await restoreClient({ id: "c1" });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      expect.objectContaining({ archivedAt: null }),
    );
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });

  it("succeeds with no write when the client is already active (AC-9)", async () => {
    state.findById.mockResolvedValue({ id: "c1", archivedAt: null });

    const result = await restoreClient({ id: "c1" });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });

  it("returns not_found if the row disappears between the read and the write", async () => {
    state.findById.mockResolvedValue({
      id: "c1",
      archivedAt: new Date("2025-06-01T00:00:00.000Z"),
    });
    state.update.mockResolvedValue(undefined);

    const result = await restoreClient({ id: "c1" });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });
});
