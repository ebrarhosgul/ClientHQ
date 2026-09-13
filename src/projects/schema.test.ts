/**
 * covers: spec 0010 AC-2
 */
import { describe, expect, it } from "vitest";

import {
  createProjectInput,
  transitionProjectInput,
  updateProjectInput,
} from "./schema";

const CLIENT_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

describe("createProjectInput", () => {
  it("accepts a client and a name with everything else absent", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toBeUndefined();
    expect(result.success && result.data.dueDate).toBeUndefined();
  });

  it("rejects a blank name", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a name over 200 characters", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "a".repeat(201),
    });

    expect(result.success).toBe(false);
  });

  it("treats a blank description as absent", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      description: "   ",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toBeUndefined();
  });

  it("rejects a description over 5000 characters", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      description: "a".repeat(5001),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a client id that is not a uuid", () => {
    const result = createProjectInput.safeParse({
      clientId: "not-a-uuid",
      name: "Website relaunch",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a real calendar date", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      dueDate: "2026-03-15",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.dueDate).toBe("2026-03-15");
  });

  it("rejects an impossible calendar date", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      dueDate: "2026-02-30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed date string", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      dueDate: "03/15/2026",
    });

    expect(result.success).toBe(false);
  });

  it("treats a blank due date as absent", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      dueDate: "",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.dueDate).toBeUndefined();
  });

  it("never accepts a status field", () => {
    const result = createProjectInput.safeParse({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      status: "delivered",
    });

    expect(result.success).toBe(true);
    expect(result.success && "status" in result.data).toBe(false);
  });
});

describe("updateProjectInput", () => {
  it("clears the description on a blank value rather than leaving it absent", () => {
    const result = updateProjectInput.safeParse({
      id: PROJECT_ID,
      name: "Website relaunch",
      description: "",
      dueDate: "",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toBeNull();
    expect(result.success && result.data.dueDate).toBeNull();
  });

  it("keeps a filled in due date", () => {
    const result = updateProjectInput.safeParse({
      id: PROJECT_ID,
      name: "Website relaunch",
      description: "",
      dueDate: "2026-04-01",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.dueDate).toBe("2026-04-01");
  });

  it("rejects a blank name", () => {
    const result = updateProjectInput.safeParse({
      id: PROJECT_ID,
      name: "",
      description: "",
      dueDate: "",
    });

    expect(result.success).toBe(false);
  });

  it("never accepts a clientId field", () => {
    const result = updateProjectInput.safeParse({
      id: PROJECT_ID,
      name: "Website relaunch",
      description: "",
      dueDate: "",
      clientId: "22222222-2222-7222-8222-222222222223",
    });

    expect(result.success).toBe(true);
    expect(result.success && "clientId" in result.data).toBe(false);
  });
});

describe("transitionProjectInput", () => {
  it("accepts a real pair of statuses", () => {
    const result = transitionProjectInput.safeParse({
      id: PROJECT_ID,
      from: "planning",
      to: "in_progress",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    const result = transitionProjectInput.safeParse({
      id: PROJECT_ID,
      from: "planning",
      to: "cancelled",
    });

    expect(result.success).toBe(false);
  });
});
