/**
 * The allowlist and the size cap, in one place with no server imports (spec
 * 0011, AC-3), so the browser's file picker and `requestUpload`'s server
 * side check share exactly the same list. The server check is the one that
 * counts; the picker's `accept` attribute is only ever a hint.
 */

export const MAX_UPLOAD_BYTES = 104_857_600; // 100 MB

export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/zip",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export function isAllowedContentType(
  value: string,
): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

const TYPE_LABELS: Readonly<Record<AllowedContentType, string>> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint",
  "text/plain": "Text",
  "text/csv": "CSV",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "application/zip": "ZIP",
};

/** A short label for a content type, or the type itself when it is not on the allowlist. */
export function typeLabel(contentType: string): string {
  return isAllowedContentType(contentType)
    ? TYPE_LABELS[contentType]
    : contentType;
}

/** The `accept` attribute for the file picker, derived from the same list. */
export const UPLOAD_ACCEPT = ALLOWED_CONTENT_TYPES.join(",");
