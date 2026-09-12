/**
 * @vitest-environment node
 *
 * covers: spec 0009 AC-5, AC-6
 *
 * `sendEmail` never throws: whichever transport it picks, a provider refusal
 * or a thrown SDK error both come back as the same `unavailable` result, and
 * the choice between the console transport and Resend follows
 * `isEmailConfigured()` alone. `formatAddress` and `renderEmail` already have
 * their own coverage in `src/contacts/invitation-email.test.ts`.
 */
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  isEmailConfigured: vi.fn(),
  env: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

vi.mock("@/lib/env", () => ({
  isEmailConfigured: mocks.isEmailConfigured,
  env: mocks.env,
}));

const { sendEmail } = await import("./send");

function message() {
  return {
    to: "ada@northwind.example",
    from: { address: "invites@clienthq.example", name: "Bright & Co" },
    replyTo: "sam@bright.example",
    subject: "You are invited",
    react: createElement("p", null, "Hello"),
    idempotencyKey: "client-invitation/contact-1/abc123",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendEmail, console transport", () => {
  beforeEach(() => {
    mocks.isEmailConfigured.mockReturnValue(false);
  });

  it("prints the message and returns a fake id, without calling Resend", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendEmail(message());

    expect(result).toEqual({
      ok: true,
      data: { id: "console-client-invitation/contact-1/abc123" },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);

    const printed = infoSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain("To:       ada@northwind.example");
    expect(printed).toContain("Reply-To: sam@bright.example");
    expect(printed).toContain("Subject:  You are invited");
    expect(printed).toContain("Key:      client-invitation/contact-1/abc123");

    infoSpy.mockRestore();
  });

  it("omits the Reply-To line when the message has none", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendEmail({ ...message(), replyTo: undefined });

    const printed = infoSpy.mock.calls[0]?.[0] as string;
    expect(printed).not.toContain("Reply-To:");

    infoSpy.mockRestore();
  });
});

describe("sendEmail, Resend transport", () => {
  beforeEach(() => {
    mocks.isEmailConfigured.mockReturnValue(true);
    mocks.env.mockReturnValue({ RESEND_API_KEY: "re_test_key" });
  });

  it("sends through Resend with the idempotency key and reports its id", async () => {
    mocks.send.mockResolvedValue({ data: { id: "resend_123" }, error: null });

    const result = await sendEmail(message());

    expect(result).toEqual({ ok: true, data: { id: "resend_123" } });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Bright & Co" <invites@clienthq.example>',
        to: ["ada@northwind.example"],
        replyTo: "sam@bright.example",
        subject: "You are invited",
      }),
      { idempotencyKey: "client-invitation/contact-1/abc123" },
    );
  });

  it("reports unavailable when Resend answers with an error", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { message: "invalid recipient" },
    });

    const result = await sendEmail(message());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "The email could not be sent. Try again in a moment.",
      },
    });
  });

  it("reports unavailable rather than throwing when the SDK call rejects", async () => {
    mocks.send.mockRejectedValue(new Error("network outage"));

    const result = await sendEmail(message());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "The email could not be sent. Try again in a moment.",
      },
    });
  });
});
