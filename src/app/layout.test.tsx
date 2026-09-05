/**
 * Tests for the root layout.
 *
 * The layout renders `<html>` and `<body>`, which Testing Library cannot mount
 * inside a container div without invalid nesting. So it is rendered to static
 * markup instead, which is what the server does anyway.
 *
 * `next/font/google` is mocked: it is a build time transform, and outside
 * `next build` it has nothing to load.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans", className: "font-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono", className: "font-mono" }),
}));

const { default: RootLayout, metadata } = await import("./layout");

/** The generated `LayoutProps<"/">` type is not available outside a Next build. */
function renderLayout(children: React.ReactNode) {
  const Layout = RootLayout as unknown as (props: {
    children: React.ReactNode;
  }) => React.ReactElement;
  return renderToStaticMarkup(<Layout>{children}</Layout>);
}

describe("root layout", () => {
  describe("metadata", () => {
    it("falls back to the product name when a page sets no title", () => {
      expect(metadata.title).toMatchObject({ default: "ClientHQ" });
    });

    it("suffixes every page title with the product name", () => {
      // Feature pages set only their own title; the template does the rest.
      expect(metadata.title).toMatchObject({ template: "%s · ClientHQ" });
    });

    it("carries a description, which search results and link previews need", () => {
      expect(metadata.description).toEqual(expect.stringMatching(/\S/));
    });
  });

  describe("document", () => {
    it("declares the page language, so screen readers pick the right voice", () => {
      const html = renderLayout(<p>content</p>);

      expect(html).toMatch(/<html[^>]*lang="en"/);
    });

    it("renders its children inside the body", () => {
      const html = renderLayout(<p>a child of the layout</p>);

      expect(html).toContain("<p>a child of the layout</p>");
    });

    it("renders one html element and one body element", () => {
      const html = renderLayout(<p>content</p>);

      expect(html.match(/<html/g)).toHaveLength(1);
      expect(html.match(/<body/g)).toHaveLength(1);
    });

    it("exposes the font variables the stylesheet reads", () => {
      const html = renderLayout(<p>content</p>);

      expect(html).toContain("--font-geist-sans");
      expect(html).toContain("--font-geist-mono");
    });
  });
});
