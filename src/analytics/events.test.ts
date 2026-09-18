/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-9, AC-12, AC-13
 *
 * The catalogue's privacy rule as a test: no event, person or group property
 * may be named like personal data, and no portal event may carry a person.
 */
import { describe, expect, it } from "vitest";

import {
  AGENCY_PROPERTIES,
  EVENT_NAMES,
  EVENTS,
  PERSON_PROPERTIES,
} from "./events";

const FORBIDDEN =
  /email|name|amount|title|note|file|address|phone|description/i;

function keysOf(schema: { readonly shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape);
}

describe("the catalogue (AC-9)", () => {
  it("declares every event spec 0019 lists", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "onboarding.started",
        "agency.created",
        "client.created",
        "project.created",
        "deliverable.uploaded",
        "deliverable.shared",
        "contact.invited",
        "contact.accepted",
        "team_member.invited",
        "team_member.joined",
        "invoice.issued",
        "invoice.paid",
        "invoice.voided",
        "invoice.pdf_downloaded",
        "checkout.started",
        "subscription.started",
        "subscription.changed",
        "portal.viewed",
        "portal.invoice_viewed",
        "portal.file_downloaded",
      ].sort(),
    );
  });

  it("has no event property named like personal data", () => {
    EVENT_NAMES.forEach((name) => {
      keysOf(EVENTS[name].schema).forEach((key) => {
        expect(key, `${name}.${key}`).not.toMatch(FORBIDDEN);
      });
    });
  });

  it("has no person or group property named like personal data", () => {
    [...keysOf(PERSON_PROPERTIES), ...keysOf(AGENCY_PROPERTIES)].forEach(
      (key) => {
        expect(key).not.toMatch(FORBIDDEN);
      },
    );
  });

  it("person and group property sets are exactly the allowed ones (AC-13)", () => {
    expect(keysOf(PERSON_PROPERTIES).sort()).toEqual(["created_at", "role"]);
    expect(keysOf(AGENCY_PROPERTIES).sort()).toEqual([
      "created_at",
      "subscribed_at",
      "subscription_status",
      "team_size",
      "trial_ends_at",
    ]);
  });
});

describe("portal events (AC-12)", () => {
  const portalEvents = EVENT_NAMES.filter((name) => name.startsWith("portal."));

  it("exist", () => {
    expect(portalEvents.length).toBe(3);
  });

  it("carry a client id and never a user or contact id", () => {
    portalEvents.forEach((name) => {
      const keys = keysOf(EVENTS[name].schema);

      expect(keys, name).toContain("client_id");
      expect(keys, name).not.toContain("user_id");
      expect(keys, name).not.toContain("contact_id");
      expect(EVENTS[name].subject, name).toBe("client");
    });
  });

  it("contact.accepted is a client event too", () => {
    expect(EVENTS["contact.accepted"].subject).toBe("client");
  });
});
