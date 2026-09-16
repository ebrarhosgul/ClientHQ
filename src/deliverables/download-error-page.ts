/**
 * The readable pages the download route answers outside the normal app
 * shell (spec 0011, AC-9, AC-12, AC-13, AC-14, AC-18): the row doesn't
 * resolve (missing, wrong tenant, not ready), the object behind a `ready`
 * row is missing, and storage is not configured at all.
 *
 * A route handler renders no layout, so this is a small standalone HTML
 * document rather than a React page: it inlines the handful of design
 * tokens (`design.md`) it needs for both themes via `prefers-color-scheme`,
 * rather than depending on a hashed, build time stylesheet path.
 *
 * `DOWNLOAD_PAGE_TOKENS` below is those values, copied by hand out of
 * `src/app/globals.css` because a route handler has no stylesheet to read
 * at request time. `src/ui/token-discipline.test.ts` does not scan this
 * directory, so nothing stops that copy drifting from the source on its
 * own; `download-error-page.test.ts` reads the same four pairs back out of
 * `globals.css` and fails if they no longer match, which is what keeps
 * these literal.
 *
 * `notFound()` from `next/navigation` is not an option here: it only
 * renders a route segment's `not-found.js` boundary, which a route handler,
 * having no page or layout of its own, never has. Called from this file,
 * it still throws and still ends the response with status `404`, but with
 * an empty body, not the app's actual not found page. `notFoundResponse()`
 * below is the same page `src/app/not-found.tsx` shows, built by hand for
 * the same reason `downloadErrorResponse` is: no layout to render it in.
 */

export type DownloadErrorPage = {
  readonly status: number;
  readonly heading: string;
  readonly body: string;
  /** One anchor under the body paragraph (spec 0013, AC-6). Every existing caller omits it. */
  readonly link?: { readonly href: string; readonly label: string };
};

/**
 * The four token pairs this page needs, pinned to `src/app/globals.css` by
 * `download-error-page.test.ts`. Keyed by the same custom property names
 * `globals.css` declares them under, so the test can compare each value
 * directly against what that file's `tokens:light` and `tokens:dark-explicit`
 * blocks say.
 */
export const DOWNLOAD_PAGE_TOKENS: Readonly<
  Record<"light" | "dark", Readonly<Record<string, string>>>
> = {
  light: {
    "--background": "oklch(0.994 0.002 70)",
    "--foreground": "oklch(0.22 0.008 70)",
    "--muted-foreground": "oklch(0.44 0.01 70)",
    "--border": "oklch(0.885 0.005 70)",
  },
  dark: {
    "--background": "oklch(0.175 0.006 70)",
    "--foreground": "oklch(0.945 0.004 70)",
    "--muted-foreground": "oklch(0.735 0.01 70)",
    "--border": "oklch(0.355 0.008 70)",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function downloadErrorResponse({
  status,
  heading,
  body,
  link,
}: DownloadErrorPage): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(heading)}</title>
<style>
  :root {
    color-scheme: light dark;
    --background: ${DOWNLOAD_PAGE_TOKENS.light["--background"]};
    --foreground: ${DOWNLOAD_PAGE_TOKENS.light["--foreground"]};
    --muted-foreground: ${DOWNLOAD_PAGE_TOKENS.light["--muted-foreground"]};
    --border: ${DOWNLOAD_PAGE_TOKENS.light["--border"]};
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: ${DOWNLOAD_PAGE_TOKENS.dark["--background"]};
      --foreground: ${DOWNLOAD_PAGE_TOKENS.dark["--foreground"]};
      --muted-foreground: ${DOWNLOAD_PAGE_TOKENS.dark["--muted-foreground"]};
      --border: ${DOWNLOAD_PAGE_TOKENS.dark["--border"]};
    }
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--background);
    color: var(--foreground);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main {
    max-width: 32rem;
    text-align: center;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 2rem 1.75rem;
  }
  h1 {
    font-size: 1.125rem;
    margin: 0 0 0.5rem;
  }
  p {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.9375rem;
    line-height: 1.5;
  }
  a {
    display: inline-block;
    margin-top: 1rem;
    color: var(--foreground);
  }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
${link === undefined ? "" : `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`}
</main>
</body>
</html>
`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * The same wording as `src/app/not-found.tsx`, for every case the download
 * route treats as a plain nonexistent id: a non uuid, a row that isn't
 * this caller's to see, or a row that isn't `ready` (spec 0011, AC-9,
 * AC-12, AC-13). Every one of those cases returns this exact response, so
 * they are indistinguishable from one another and from a truly nonexistent
 * id, as the spec requires.
 */
export function notFoundResponse(): Response {
  return downloadErrorResponse({
    status: 404,
    heading: "Page not found",
    body: "This address does not lead anywhere. It may have moved, or the link that brought you here may be out of date.",
  });
}
