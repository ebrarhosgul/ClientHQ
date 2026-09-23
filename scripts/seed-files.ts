/**
 * The bytes behind the seeded deliverables.
 *
 * Every function here is pure and deterministic, so the size the seed writes to
 * a deliverable row is the size of the file it uploads, and a second run
 * uploads identical bytes. The files are small on purpose (a few hundred bytes
 * to a few kilobytes) and valid: the PDF opens, the PNG decodes, the JSON
 * parses.
 *
 * `scripts/db-seed.ts` puts them in the dev bucket when R2 is configured. With
 * R2 unset the rows still seed, and a download lands on the "This file is
 * missing" page instead of a storage error.
 */
import { deflateSync } from "node:zlib";

const encoder = new TextEncoder();

const text = (value: string): Uint8Array => encoder.encode(value);

/** The content type a seeded file name implies. */
export function contentTypeFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();

  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Escape the three characters a PDF string literal treats specially. */
const pdfString = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * A one page PDF with a title and some lines of text, in the built in
 * Helvetica so it needs no embedded font. The cross reference table is
 * computed from the real object lengths, which is what makes it valid rather
 * than merely openable by a forgiving viewer. ASCII only, so a string's length
 * is its byte length.
 */
export function minimalPdf(
  title: string,
  lines: readonly string[],
): Uint8Array {
  const content = [
    "BT",
    "/F1 20 Tf",
    "72 720 Td",
    `(${pdfString(title)}) Tj`,
    "/F1 11 Tf",
    ...lines.flatMap((line) => ["0 -24 Td", `(${pdfString(line)}) Tj`]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>",
    "<< /Type /Font /Subtype /Font /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ].map((body, index) => `${index + 1} 0 obj\n${body}\nendobj\n`);

  const header = "%PDF-1.4\n";

  // Each object starts where the header and every object before it end.
  const offsets = objects.map(
    (_, index) =>
      header.length +
      objects
        .slice(0, index)
        .reduce((total, object) => total + object.length, 0),
  );

  const xrefStart =
    header.length + objects.reduce((total, object) => total + object.length, 0);

  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
  ].join("\n");

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return text(`${header}${objects.join("")}${xref}\n${trailer}`);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) =>
  Array.from({ length: 8 }).reduce<number>(
    (c) => (c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1),
    n,
  ),
);

const crc32 = (bytes: Uint8Array): number =>
  (bytes.reduce(
    (crc, byte) => (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8),
    0xffffffff,
  ) ^
    0xffffffff) >>>
  0;

const uint32 = (value: number): Uint8Array =>
  Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );

const concat = (parts: readonly Uint8Array[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => Array.from(part)));

/** One PNG chunk: length, type, data, and the CRC of type plus data. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concat([text(type), data]);

  return concat([uint32(data.length), typeAndData, uint32(crc32(typeAndData))]);
}

type Rgb = readonly [number, number, number];

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: Rgb;
};

const WIDTH = 480;
const HEIGHT = 270;
const BACKGROUND: Rgb = [248, 250, 252];
const INK: Rgb = [30, 41, 59];
const BORDER = 3;

/**
 * The architecture diagram as boxes and connectors: a web app and a mobile app
 * reading design tokens through one package, which a Storybook builds from.
 * There is no text, since drawing glyphs would need a font; the shapes are
 * what a demo download needs to look like an image.
 */
const DIAGRAM: readonly Box[] = [
  // The two apps, side by side on top.
  { x: 40, y: 30, width: 150, height: 60, fill: [191, 219, 254] },
  { x: 290, y: 30, width: 150, height: 60, fill: [191, 219, 254] },
  // The tokens package they both read.
  { x: 165, y: 120, width: 150, height: 50, fill: [253, 230, 138] },
  // Storybook, built from the same tokens.
  { x: 165, y: 205, width: 150, height: 45, fill: [187, 247, 208] },
];

const CONNECTORS: readonly Box[] = [
  { x: 113, y: 90, width: 4, height: 45, fill: INK },
  { x: 113, y: 133, width: 52, height: 4, fill: INK },
  { x: 363, y: 90, width: 4, height: 45, fill: INK },
  { x: 315, y: 133, width: 52, height: 4, fill: INK },
  { x: 238, y: 170, width: 4, height: 35, fill: INK },
];

const inside = (box: Box, x: number, y: number): boolean =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;

const onBorder = (box: Box, x: number, y: number): boolean =>
  inside(box, x, y) &&
  !inside(
    {
      ...box,
      x: box.x + BORDER,
      y: box.y + BORDER,
      width: box.width - BORDER * 2,
      height: box.height - BORDER * 2,
    },
    x,
    y,
  );

function pixel(x: number, y: number): Rgb {
  const connector = CONNECTORS.find((box) => inside(box, x, y));
  if (connector !== undefined) return connector.fill;

  const box = DIAGRAM.find((candidate) => inside(candidate, x, y));
  if (box === undefined) return BACKGROUND;

  return onBorder(box, x, y) ? INK : box.fill;
}

/** A 480 by 270 RGB PNG of the diagram above. */
export function architectureDiagramPng(): Uint8Array {
  const scanlines = Array.from({ length: HEIGHT }, (_, y) => [
    0, // filter type: none
    ...Array.from({ length: WIDTH }, (_unused, x) => pixel(x, y)).flat(),
  ]).flat();

  const header = concat([
    uint32(WIDTH),
    uint32(HEIGHT),
    Uint8Array.of(8, 2, 0, 0, 0), // 8 bit, RGB, deflate, no filter, no interlace
  ]);

  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Uint8Array.from(scanlines))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

// ---------------------------------------------------------------------------
// Text files
// ---------------------------------------------------------------------------

const DESIGN_TOKENS = {
  name: "northstar-design-tokens",
  version: "2.1.0",
  color: {
    brand: { 500: "#2563eb", 600: "#1d4ed8", 700: "#1e40af" },
    neutral: { 50: "#f8fafc", 500: "#64748b", 900: "#0f172a" },
    feedback: {
      success: "#16a34a",
      warning: "#d97706",
      danger: "#dc2626",
    },
  },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  radius: { sm: "4px", md: "8px", pill: "999px" },
  typography: {
    family: { sans: "Inter, system-ui, sans-serif" },
    size: { body: "16px", small: "14px", heading: "24px" },
  },
} as const;

const MARKDOWN_BODIES: Readonly<Record<string, string>> = {
  "mobile-release-notes-q3.md": [
    "# Mobile app release notes, Q3",
    "",
    "## Shipped",
    "",
    "- Biometric sign in on iOS and Android",
    "- Offline mode for the dashboard, syncing when the connection returns",
    "- A rebuilt navigation with a five item tab bar",
    "",
    "## Fixed",
    "",
    "- Push notifications arriving twice on Android 14",
    "- Chart labels clipped on small screens",
    "",
  ].join("\n"),
  "kyc-copy-deck.md": [
    "# Onboarding copy deck",
    "",
    "| Step | Heading | Helper text |",
    "| --- | --- | --- |",
    "| 1 | Tell us about your firm | We use this to tailor your account. |",
    "| 2 | Verify your identity | It takes about two minutes. |",
    "| 3 | Connect your bank | Read only access. We can never move money. |",
    "",
  ].join("\n"),
  "internal-qa-regression-log.md": [
    "# QA regression log (internal)",
    "",
    "Not for the client. Time spent and defects found per build.",
    "",
    "- Build 41: 3 defects, all fixed",
    "- Build 42: 1 defect, fixed",
    "",
  ].join("\n"),
  "component-migration-risk-register.md": [
    "# Component migration risk register (internal)",
    "",
    "1. Legacy modal relies on a global z index. Mitigation: portal it.",
    "2. Three forms use uncontrolled inputs. Mitigation: migrate one at a time.",
    "",
  ].join("\n"),
  "usability-test-findings-internal.md": [
    "# Usability test findings (internal)",
    "",
    "Five sessions. Four of five stalled on the identity check step.",
    "Recommendation: show progress and a time estimate up front.",
    "",
  ].join("\n"),
};

const PDF_BODIES: Readonly<
  Record<string, { readonly title: string; readonly lines: readonly string[] }>
> = {
  "executive-summary.pdf": {
    title: "Q3 Mobile App Overhaul: Executive Summary",
    lines: [
      "Outcome: the rebuilt app shipped on schedule and on budget.",
      "Adoption: 62 percent of active users moved to the new app in week one.",
      "Next: design system migration to remove duplicated components.",
    ],
  },
  "onboarding-flow-wireframes.pdf": {
    title: "Client Onboarding Flow: Wireframes",
    lines: [
      "Five screens, from firm details to bank connection.",
      "Review the flow and leave comments before the prototype build.",
    ],
  },
};

/**
 * The bytes for one seeded file, chosen by its name. A name with no content of
 * its own gets a short placeholder so it is still a real, downloadable file.
 */
export function mockFileBytes(name: string): Uint8Array {
  const pdf = PDF_BODIES[name];
  if (pdf !== undefined) return minimalPdf(pdf.title, pdf.lines);

  switch (contentTypeFor(name)) {
    case "application/pdf":
      return minimalPdf(name, ["Demo content for ClientHQ."]);
    case "image/png":
      return architectureDiagramPng();
    case "application/json":
      return text(`${JSON.stringify(DESIGN_TOKENS, undefined, 2)}\n`);
    default:
      return text(
        MARKDOWN_BODIES[name] ?? `# ${name}\n\nDemo content for ClientHQ.\n`,
      );
  }
}
