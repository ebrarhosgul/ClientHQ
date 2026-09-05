import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClientHQ",
};

/**
 * The entry point.
 *
 * Deliberately plain. Spec 0001 keeps `/` a minimal way in to sign in and sign
 * up, and the visual direction is not decided yet: feature 5, "Design system &
 * UI foundation", settles type, colour, spacing and the component set. Anything
 * invented here would have to be unpicked then, so this page stays a placeholder
 * that says what is standing and what is next.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">ClientHQ</h1>
        <p className="text-base leading-relaxed opacity-80">
          A portal where agencies manage their clients, projects, deliverables
          and invoices, and each of their clients gets a read only window onto
          their own work.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="foundation">
        <h2
          id="foundation"
          className="text-sm font-medium uppercase tracking-wide opacity-60"
        >
          Foundation
        </h2>
        <p className="text-sm leading-relaxed opacity-80">
          The scaffold is standing: Next.js on the App Router, TypeScript,
          Tailwind, and Postgres reached through Drizzle. Sign in, the dashboard
          and the client portal arrive with their own features.
        </p>
        <p className="text-sm leading-relaxed opacity-80">
          You can confirm the database link at{" "}
          <a
            className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            href="/api/health/db"
          >
            /api/health/db
          </a>
          .
        </p>
      </section>
    </main>
  );
}
