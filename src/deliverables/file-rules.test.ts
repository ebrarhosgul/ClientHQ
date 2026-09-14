import { describe, expect, it } from "vitest";

import {
  ALLOWED_CONTENT_TYPES,
  isAllowedContentType,
  MAX_UPLOAD_BYTES,
  typeLabel,
  UPLOAD_ACCEPT,
} from "./file-rules";

describe("isAllowedContentType", () => {
  it.each(ALLOWED_CONTENT_TYPES)("accepts %s", (type) => {
    expect(isAllowedContentType(type)).toBe(true);
  });

  it("rejects a type outside the allowlist", () => {
    expect(isAllowedContentType("application/x-msdownload")).toBe(false);
  });
});

describe("typeLabel", () => {
  it("gives every allowlisted type a short label", () => {
    expect(typeLabel("application/pdf")).toBe("PDF");
    expect(typeLabel("image/svg+xml")).toBe("SVG");
    expect(typeLabel("application/zip")).toBe("ZIP");
  });

  it("falls back to the raw type when it is not on the allowlist", () => {
    expect(typeLabel("application/x-msdownload")).toBe(
      "application/x-msdownload",
    );
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is exactly 100 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(104_857_600);
  });
});

describe("UPLOAD_ACCEPT", () => {
  it("lists every allowed content type, comma separated", () => {
    expect(UPLOAD_ACCEPT.split(",")).toEqual([...ALLOWED_CONTENT_TYPES]);
  });
});
