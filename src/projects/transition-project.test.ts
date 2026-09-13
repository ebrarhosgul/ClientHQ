/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-8, AC-9, AC-10, AC-16
 *
 * `canTransition` itself is proven in `status.test.ts`; this file exercises
 * what `transitionProject` adds on top: an illegal move never reaches the
 * database at all, the compare and set is wired through `db.update`'s
 * `options.where`, and a miss is turned into the right `conflict` message by
 * a follow up read.
 */
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { projects } from "@/db/schema";

const state = vi.hoisted(() => ({
  /** Every config handed to `withTenantAction`, so `revalidate` can be pinned (AC-16). */
  configs: [] as Array<{
    readonly name?: string;
    readonly revalidate?: unknown;
  }>,
  update: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("@/db/tenant", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction: (config: {
      readonly name?: string;
      readonly revalidate?: unknown;
      readonly input: { safeParse: (value: unknown) => never };
      readonly handler: (args: {
        readonly input: unknown;
        readonly ctx: unknown;
        readonly db: unknown;
      }) => Promise<unknown>;
    }) => {
      state.configs.push(config);

      return async (rawInput: unknown) => {
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
            db: { update: state.update, findById: state.findById },
          });

          return { ok: true, data };
        } catch (thrown) {
          if (actual.isTenantActionError(thrown)) {
            return { ok: false, error: thrown.error };
          }

          throw thrown;
        }
      };
    },
  };
});

const { transitionProject } = await import("./transition-project");
const { PROJECT_REVALIDATE } = await import("./revalidate");

const PROJECT_ID = "11111111-1111-7111-8111-111111111111";

const dialect = new PgDialect();

/** The rendered condition, which is what PostgreSQL would receive. */
function render(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error("expected a where clause, got none");
  }

  const query = dialect.sqlToQuery(sql);

  return { sql: query.sql, params: query.params };
}

function whereFromUpdate(): SQL | undefined {
  return state.update.mock.calls[0]?.[3]?.where as SQL | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("transitionProject revalidates every project surface (AC-16)", () => {
  it("passes PROJECT_REVALIDATE to withTenantAction", () => {
    const config = state.configs.find(
      (candidate) => candidate.name === "transitionProject",
    );

    expect(config?.revalidate).toBe(PROJECT_REVALIDATE);
  });
});

describe("transitionProject", () => {
  it("moves along an allowed transition (AC-8)", async () => {
    state.update.mockResolvedValue({ status: "in_progress" });

    const result = await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(result).toStrictEqual({
      ok: true,
      data: { status: "in_progress" },
    });
  });

  it("passes the from status and archived_at is null as the compare and set condition", async () => {
    state.update.mockResolvedValue({ status: "in_progress" });

    await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      { status: "in_progress" },
      { where: expect.anything() },
    );
    expect(render(whereFromUpdate())).toStrictEqual(
      render(and(eq(projects.status, "planning"), isNull(projects.archivedAt))),
    );
  });

  it("keeps archived_at is null in the condition, so an archived project is refused at the write (AC-10)", async () => {
    state.update.mockResolvedValue({ status: "in_progress" });

    await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(render(whereFromUpdate()).sql).toContain(
      render(isNull(projects.archivedAt)).sql,
    );
  });

  it("refuses an illegal move before ever reading the row (AC-8)", async () => {
    const result = await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "delivered",
    });

    expect(state.update).not.toHaveBeenCalled();
    expect(state.findById).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("refuses a move out of delivered, the final status (AC-8)", async () => {
    const result = await transitionProject({
      id: PROJECT_ID,
      from: "delivered",
      to: "in_review",
    });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("returns conflict naming the current status when the compare and set misses (AC-9)", async () => {
    state.update.mockResolvedValue(undefined);
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "in_review",
      archivedAt: null,
    });

    const result = await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("conflict");
    expect(result.ok ? undefined : result.error.message).toContain("In review");
  });

  it("returns conflict naming the project as archived when that is why it missed (AC-10)", async () => {
    state.update.mockResolvedValue(undefined);
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt: new Date(),
    });

    const result = await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("conflict");
    expect(result.ok ? undefined : result.error.message).toBe(
      "This project is archived.",
    );
  });

  it("returns not_found when the row is gone entirely", async () => {
    state.update.mockResolvedValue(undefined);
    state.findById.mockResolvedValue(undefined);

    const result = await transitionProject({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });
});
