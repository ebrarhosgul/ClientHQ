/**
 * Tests for the root layout.
 *
 * The layout renders `<html>` and `<body>`, which Testing Library cannot mount
 * inside a container div without invalid nesting. So it is rendered to static
 * markup instead, which is what the server does anyway. It is also `async` now
 * that it reads the theme cookie, so it is awaited before rendering.
 *
 * `next/font/google` is mocked: it is a build time transform, and outside
 * `next build` it has nothing to load. `next/headers` is mocked because
 * `cookies()` needs a request, and the whole point of these tests is what the
 * layout does with each answer it can get back.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-inter", className: "font-sans" }),
  JetBrains_Mono: () => ({
    variable: "--font-jetbrains-mono",
    className: "font-mono",
  }),
}));

const cookieValue = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "clienthq_theme" && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));

const { default: RootLayout, metadata } = await import("./layout");

/** The generated `LayoutProps<"/">` type is not available outside a Next build. */
async function renderLayout(children: React.ReactNode) {
  const Layout = RootLayout as unknown as (props: {
    children: React.ReactNode;
  }) => Promise<React.ReactElement>;
  return renderToStaticMarkup(await Layout({ children }));
}

beforeEach(() => {
  cookieValue.current = undefined;
});

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
    it("declares the page language, so screen readers pick the right voice", async () => {
      const html = await renderLayout(<p>content</p>);

      expect(html).toMatch(/<html[^>]*lang="en"/);
    });

    it("renders its children inside the body", async () => {
      const html = await renderLayout(<p>a child of the layout</p>);

      expect(html).toContain("<p>a child of the layout</p>");
    });

    it("renders one html element and one body element", async () => {
      const html = await renderLayout(<p>content</p>);

      expect(html.match(/<html/g)).toHaveLength(1);
      expect(html.match(/<body/g)).toHaveLength(1);
    });

    it("exposes the font variables the stylesheet reads", async () => {
      const html = await renderLayout(<p>content</p>);

      expect(html).toContain("--font-inter");
      expect(html).toContain("--font-jetbrains-mono");
    });
  });

  describe("the theme, decided on the server", () => {
    it("stamps nothing when there is no cookie, so the system preference decides", async () => {
      const html = await renderLayout(<p>content</p>);

      // Not `data-theme="system"`: the absence of the attribute is what lets
      // the `prefers-color-scheme` block in globals.css win, and it is what
      // makes a change to the operating system setting land with no reload.
      expect(html).not.toContain("data-theme");
    });

    it("stamps dark when the cookie says dark", async () => {
      cookieValue.current = "dark";

      expect(await renderLayout(<p>content</p>)).toMatch(
        /<html[^>]*data-theme="dark"/,
      );
    });

    it("stamps light when the cookie says light", async () => {
      cookieValue.current = "light";

      expect(await renderLayout(<p>content</p>)).toMatch(
        /<html[^>]*data-theme="light"/,
      );
    });

    it("ignores a cookie value that is not a theme", async () => {
      // A hand edited or stale cookie must not stamp an attribute no CSS block
      // matches, which would leave the page with no palette at all.
      cookieValue.current = "solarized";

      expect(await renderLayout(<p>content</p>)).not.toContain("data-theme");
    });

    it("paints the theme in the markup itself, not from a script", async () => {
      cookieValue.current = "dark";
      const html = await renderLayout(<p>content</p>);

      // The guarantee behind AC-8: no blocking script, so no flash of the
      // other theme on a cold load.
      expect(html).not.toMatch(/<script/);
    });
  });
});
