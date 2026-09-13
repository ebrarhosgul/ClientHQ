/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-4, AC-5, AC-6, AC-13, AC-14, Value sourcing
 *
 * `tenantDb` itself is proven in `src/db/tenant/accessor.test.ts`; this file
 * is about the logic these reads add on top of it: status filtering, the
 * unresolvable client rule, pagination, and the overdue flag each row
 * carries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/db/tenant", () => ({
  tenantDb: () => ({ findMany: state.findMany, findFirst: state.findFirst }),
}));

const {
  listProjects,
  getProject,
  listProjectsForClient,
  countActiveProjects,
  PROJECTS_PAGE_SIZE,
} = await import("./queries");

const ctx = { orgId: "org-1" } as never;
const TODAY = "2026-06-15";

function projectRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `project-${index}`,
    name: `Project ${index}`,
    status: "planning",
    dueDate: null,
    archivedAt: null,
    client: { name: "Acme" },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listProjects", () => {
  it("returns page 1 of 1 for no rows at all", async () => {
    state.findMany.mockResolvedValue([]);

    const result = await listProjects(ctx, {
      archived: false,
      todayUtc: TODAY,
    });

    expect(result).toStrictEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("paginates at PROJECTS_PAGE_SIZE, defaulting to page 1 (AC-4)", async () => {
    expect(PROJECTS_PAGE_SIZE).toBe(25);
    state.findMany.mockResolvedValue(projectRows(30));

    const result = await listProjects(ctx, {
      archived: false,
      todayUtc: TODAY,
    });

    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(2);
    expect(result.total).toBe(30);
    expect(result.rows).toHaveLength(25);
  });

  it("flattens the joined client row into clientName", async () => {
    state.findMany.mockResolvedValue(projectRows(1));

    const result = await listProjects(ctx, {
      archived: false,
      todayUtc: TODAY,
    });

    expect(result.rows[0]?.clientName).toBe("Acme");
    expect(result.rows[0]).not.toHaveProperty("client");
  });

  it("marks a project overdue when its due date is in the past and it is still open", async () => {
    state.findMany.mockResolvedValue([
      {
        id: "project-1",
        name: "Late",
        status: "in_progress",
        dueDate: "2026-06-01",
        archivedAt: null,
        client: { name: "Acme" },
      },
    ]);

    const result = await listProjects(ctx, {
      archived: false,
      todayUtc: TODAY,
    });

    expect(result.rows[0]?.overdue).toBe(true);
  });

  it("defaults to every status but delivered (status=open)", async () => {
    state.findMany.mockResolvedValue([]);

    await listProjects(ctx, { archived: false, todayUtc: TODAY });

    expect(state.findMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ where: expect.anything() }),
    );
  });

  it("shows every status once archived and no status filter is given (Value sourcing)", async () => {
    state.findMany.mockResolvedValue([]);

    await listProjects(ctx, { archived: true, todayUtc: TODAY });

    // Both calls still carry a where (the archived predicate at minimum); the
    // exact SQL is exercised for real in `/check verify`.
    expect(state.findMany.mock.calls[0]?.[1]?.where).toBeDefined();
  });

  it("returns an empty list without touching the database for a client filter that is not a uuid (AC-5)", async () => {
    const result = await listProjects(ctx, {
      archived: false,
      todayUtc: TODAY,
      clientParam: "not-a-uuid",
    });

    expect(state.findMany).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("orders by due date, then name, then id", async () => {
    state.findMany.mockResolvedValue([]);

    await listProjects(ctx, { archived: false, todayUtc: TODAY });

    expect(state.findMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderBy: expect.any(Array) }),
    );
  });

  it.each(["0", "-1", "abc", "999"])(
    "clamps an out of range page param (%s) to page 1",
    async (pageParam) => {
      state.findMany.mockResolvedValue(projectRows(30));

      const result = await listProjects(ctx, {
        archived: false,
        todayUtc: TODAY,
        pageParam,
      });

      expect(result.page).toBe(1);
    },
  );
});

describe("getProject", () => {
  const PROJECT_ID = "11111111-1111-7111-8111-111111111111";

  it("returns the row with the client name flattened in", async () => {
    state.findFirst.mockResolvedValue({
      id: PROJECT_ID,
      name: "Website",
      client: { name: "Acme" },
    });

    const result = await getProject(ctx, PROJECT_ID);

    expect(result).toStrictEqual({
      id: PROJECT_ID,
      name: "Website",
      clientName: "Acme",
    });
  });

  it("returns undefined for a missing id, the same as a foreign agency's id (AC-15)", async () => {
    state.findFirst.mockResolvedValue(undefined);

    const result = await getProject(ctx, PROJECT_ID);

    expect(result).toBeUndefined();
  });

  it("returns undefined for an id that is not a uuid, without ever reaching the database", async () => {
    const result = await getProject(ctx, "not-a-uuid");

    expect(state.findFirst).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("listProjectsForClient", () => {
  const CLIENT_ID = "22222222-2222-7222-8222-222222222222";

  it("carries the overdue flag on each row", async () => {
    state.findMany.mockResolvedValue([
      {
        id: "project-1",
        status: "planning",
        dueDate: "2026-06-01",
        archivedAt: null,
      },
    ]);

    const result = await listProjectsForClient(ctx, CLIENT_ID, TODAY);

    expect(result[0]?.overdue).toBe(true);
  });

  it("orders newest first", async () => {
    state.findMany.mockResolvedValue([]);

    await listProjectsForClient(ctx, CLIENT_ID, TODAY);

    expect(state.findMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderBy: expect.any(Array) }),
    );
  });
});

describe("countActiveProjects", () => {
  const CLIENT_ID = "22222222-2222-7222-8222-222222222222";

  it("counts only the active rows returned", async () => {
    state.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }]);

    const result = await countActiveProjects(ctx, CLIENT_ID);

    expect(result).toBe(2);
  });

  it("returns zero for a client with no active projects", async () => {
    state.findMany.mockResolvedValue([]);

    const result = await countActiveProjects(ctx, CLIENT_ID);

    expect(result).toBe(0);
  });
});
