/**
 * The two readable pages the download route answers outside the normal app
 * shell (spec 0011, AC-14, AC-18): the object behind a `ready` row is
 * missing, and storage is not configured at all.
 *
 * A route handler renders no layout, so this is a small standalone HTML
 * document rather than a React page: it inlines the handful of design
 * tokens (`design.md`) it needs for both themes via `prefers-color-scheme`,
 * rather than depending on a hashed, build time stylesheet path.
 */

export type DownloadErrorPage = {
  readonly status: number;
  readonly heading: string;
  readonly body: string;
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
    --background: oklch(0.994 0.002 70);
    --foreground: oklch(0.22 0.008 70);
    --muted-foreground: oklch(0.44 0.01 70);
    --border: oklch(0.885 0.005 70);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: oklch(0.175 0.006 70);
      --foreground: oklch(0.945 0.004 70);
      --muted-foreground: oklch(0.735 0.01 70);
      --border: oklch(0.355 0.008 70);
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
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>
`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
