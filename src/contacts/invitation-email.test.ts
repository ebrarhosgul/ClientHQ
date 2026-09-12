/**
 * @vitest-environment node
 *
 * covers: spec 0009 AC-5
 *
 * The message exactly as a send would render it: subject, envelope, the accept
 * link with the token URL encoded, the expiry as a UTC calendar date, the
 * idempotency key convention, and a plain text part that carries the link too.
 */
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { formatAddress, renderEmail } from "@/email/send";

import {
  acceptUrl,
  composeInvitation,
  invitationIdempotencyKey,
  type InvitationDetails,
} from "./invitation-email";
import { generateToken, hashToken } from "./token";

const CONTACT_ID = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";

function details(
  overrides: Partial<InvitationDetails> = {},
): InvitationDetails {
  const token = overrides.token ?? generateToken(CONTACT_ID);

  return {
    contactId: CONTACT_ID,
    contactName: "Ada Lovelace",
    contactEmail: "ada@northwind.example",
    clientName: "Northwind Coffee",
    agencyName: "Bright & Co",
    inviterEmail: "sam@bright.example",
    token,
    digest: hashToken(token),
    expiresAt: new Date("2026-09-19T12:00:00.000Z"),
    baseUrl: "https://app.clienthq.example",
    fromAddress: "invites@clienthq.example",
    ...overrides,
  };
}

describe("acceptUrl", () => {
  it("is the base URL plus /portal/accept with the token URL encoded", () => {
    const url = acceptUrl("https://app.clienthq.example", "a.b+c/d");

    expect(url).toBe(
      "https://app.clienthq.example/portal/accept?token=a.b%2Bc%2Fd",
    );
  });

  it("ignores a path on the base URL rather than nesting under it", () => {
    expect(acceptUrl("https://app.clienthq.example/some/path", "x.y")).toBe(
      "https://app.clienthq.example/portal/accept?token=x.y",
    );
  });
});

describe("invitationIdempotencyKey", () => {
  it("is client-invitation, the contact id, and the first twelve hex characters of the digest", () => {
    const digest = hashToken("anything");

    expect(invitationIdempotencyKey(CONTACT_ID, digest)).toBe(
      `client-invitation/${CONTACT_ID}/${digest.slice(0, 12)}`,
    );
    expect(invitationIdempotencyKey(CONTACT_ID, digest).length).toBeLessThan(
      256,
    );
  });

  it("is stable for one token and different for a new one", () => {
    const one = details();
    const two = details();

    expect(composeInvitation(one).idempotencyKey).toBe(
      composeInvitation(one).idempotencyKey,
    );
    expect(composeInvitation(one).idempotencyKey).not.toBe(
      composeInvitation(two).idempotencyKey,
    );
  });
});

describe("composeInvitation", () => {
  it("sets the envelope from the agency, the sending address and the inviter", () => {
    const message = composeInvitation(details());

    expect(message.to).toBe("ada@northwind.example");
    expect(message.subject).toBe(
      "Bright & Co invited you to their client portal",
    );
    expect(message.from).toEqual({
      address: "invites@clienthq.example",
      name: "Bright & Co via ClientHQ",
    });
    expect(message.replyTo).toBe("sam@bright.example");
  });

  it("renders HTML and plain text that both carry the link and the expiry date", async () => {
    const input = details();
    const message = composeInvitation(input);
    const rendered = await renderEmail(message);
    const link = acceptUrl(input.baseUrl, input.token);

    expect(rendered.html).toContain(`href="${link}"`);
    expect(rendered.html).toContain("Northwind Coffee");
    expect(rendered.html).toContain("Bright &amp; Co");
    expect(rendered.html).toContain("19 September 2026 (UTC)");

    expect(rendered.text).toContain(link);
    expect(rendered.text).toContain("19 September 2026 (UTC)");
    expect(rendered.text).not.toContain("<");
    expect(rendered.from).toBe(
      '"Bright & Co via ClientHQ" <invites@clienthq.example>',
    );
    expect(rendered.replyTo).toBe("sam@bright.example");
    expect(rendered.idempotencyKey).toBe(message.idempotencyKey);
  });

  it("carries the token only in the link, never the digest", async () => {
    const input = details();
    const text = await render(composeInvitation(input).react, {
      plainText: true,
    });

    expect(text).toContain(
      encodeURIComponent(input.token).replace(/%2E/gu, "."),
    );
    expect(text).not.toContain(input.digest);
  });

  it("leaves reply to unset when the inviter's row is gone", () => {
    expect(
      composeInvitation(details({ inviterEmail: undefined })).replyTo,
    ).toBeUndefined();
  });
});

describe("formatAddress", () => {
  it("quotes the display name and strips anything that could smuggle in a second address", () => {
    expect(formatAddress({ address: "a@b.c" })).toBe("a@b.c");
    expect(
      formatAddress({ address: "a@b.c", name: "Bright & Co via ClientHQ" }),
    ).toBe('"Bright & Co via ClientHQ" <a@b.c>');
    expect(
      formatAddress({ address: "a@b.c", name: 'Evil" <x@y.z>\r\nBcc: v@w.x' }),
    ).toBe('"Evil x@y.zBcc: v@w.x" <a@b.c>');
    expect(formatAddress({ address: "a@b.c", name: '"<>' })).toBe("a@b.c");
  });
});
