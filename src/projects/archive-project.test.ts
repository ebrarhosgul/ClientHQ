/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-11
 *
 * `requireRole: "admin"`'s refusal itself is `withTenantAction`'s job, proven
 * in `src/db/tenant/action.test.ts` and `guards.test.ts`; this file exercises
 * the idempotency both actions promise: archiving an already archived
 * project, or restoring an already active one, succeeds with no error and no
 * write.
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

const { archiveProject, restoreProject } = await import("./archive-project");

const PROJECT_ID = "11111111-1111-7111-8111-111111111111";
const MISSING_ID = "99999999-9999-7999-8999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("archiveProject", () => {
  it("returns not_found for a missing id, the same outcome a foreign agency's id gets", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await archiveProject({ id: MISSING_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("archives an active project from any status, keeping the status (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "in_review",
      archivedAt: null,
    });
    const archivedAt = new Date("2026-01-01T00:00:00.000Z");
    state.update.mockResolvedValue({ id: PROJECT_ID, archivedAt });

    const result = await archiveProject({ id: PROJECT_ID });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
    expect(state.update.mock.calls[0][2]).not.toHaveProperty("status");
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });

  it("succeeds with no write when the project is already archived (AC-11)", async () => {
    const archivedAt = new Date("2025-06-01T00:00:00.000Z");
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt,
    });

    const result = await archiveProject({ id: PROJECT_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });
});

describe("restoreProject", () => {
  it("returns not_found for a missing id", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await restoreProject({ id: MISSING_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("restores an archived project, clearing archived_at (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt: new Date("2025-06-01T00:00:00.000Z"),
    });
    state.update.mockResolvedValue({ id: PROJECT_ID, archivedAt: null });

    const result = await restoreProject({ id: PROJECT_ID });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ archivedAt: null }),
    );
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });

  it("succeeds with no write when the project is already active (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt: null,
    });

    const result = await restoreProject({ id: PROJECT_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });
});
