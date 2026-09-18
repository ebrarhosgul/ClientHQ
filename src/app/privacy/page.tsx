import type { Metadata } from "next";
import Link from "next/link";

import { CookieSettingsButton } from "@/analytics/ui/cookie-settings";
import { Wordmark } from "@/ui/patterns/brand";
import { ThemeControl } from "@/ui/patterns/theme-control";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What ClientHQ collects about errors and product use, what it never collects, and how to change your cookie choice.",
};

/**
 * The privacy notice (spec 0019, AC-19): public, static, in plain words.
 *
 * A notice, not a lawyer's policy: it says what the two collectors receive,
 * the exact identifiers, what is never sent, where the data lives, how long
 * the providers keep it by default, and how to change the cookie choice.
 * Same chrome as `/`, so it reads as part of the product rather than a
 * separate site.
 */
export default function PrivacyPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="rounded-sm text-sm">
          <Wordmark markClassName="size-7" />
        </Link>
        <ThemeControl />
      </header>

      <main className="flex flex-1 justify-center px-6 pb-16">
        <article className="w-full max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Privacy notice
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            ClientHQ collects two kinds of data about how the product runs:
            error reports, so that a fault can be fixed, and product events, so
            that we can see where the product loses people. This page says
            exactly what each collector receives, what it never receives, and
            how to change your cookie choice. It is written in plain words on
            purpose.
          </p>

          <Section title="What is collected">
            <p>
              <strong>Errors</strong> go to Sentry. An error report carries the
              stack trace, the runtime it happened in, the build it came from,
              the agency it happened in and the account it happened to, plus a
              masked recording of the screen from the moments before the error.
              Every piece of text, every input and every image in that recording
              is blanked out before it leaves the browser.
            </p>
            <p>
              <strong>Product events</strong> go to PostHog. A product event is
              a name, such as an invoice being issued, with the ids of the
              things involved, plus page views from the browser on the agency
              side of the product.
            </p>
          </Section>

          <Section title="The identifiers that are sent">
            <ul className="list-disc space-y-1 pl-5">
              <li>your account id (the id your sign in provider assigns)</li>
              <li>your agency&apos;s id</li>
              <li>
                a client&apos;s id, on events about a client&apos;s portal
              </li>
              <li>your role in the agency (admin or member)</li>
              <li>dates, such as when the agency was created</li>
              <li>counts, such as the size of the team</li>
            </ul>
          </Section>

          <Section title="What is never sent">
            <p>
              No email address, no name, no invoice amount, no file name, no
              note, no client company name, no request headers, no cookies and
              no form contents. Both collectors are configured to refuse those,
              and a test in the codebase fails if an event ever declares one.
            </p>
          </Section>

          <Section title="Client contacts">
            <p>
              If you are a client contact using the portal your agency shares
              with you, you are not profiled at all. No analytics script loads
              on a portal page, no analytics cookie is set there, and no person
              record exists for you anywhere. The few events about portal use
              name the client company, never the person.
            </p>
          </Section>

          <Section title="Where the data lives, and for how long">
            <p>
              Error reports live in the Sentry region chosen when the project
              was created, in the European Union or the United States. Product
              events live in PostHog&apos;s European Union cloud. Each provider
              keeps data for its default retention period, which is the period
              shown in that provider&apos;s own dashboard: ninety days for
              Sentry error events and replays, and the plan&apos;s default for
              PostHog events. Error tracking with masked recordings rests on our
              legitimate interest in keeping the product working; the analytics
              cookie is set only with your consent.
            </p>
          </Section>

          <Section title="The cookie, and how to change your choice">
            <p>
              Page view analytics run without any cookie until you accept one.
              Your choice is stored in a single first party cookie named{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                clienthq_consent
              </code>
              , for one year. Accepting lets the analytics client remember an
              anonymous id across visits; declining keeps it in memory only, and
              nothing about the product changes either way.
            </p>
            <p>
              To change your choice, press the button below and the banner will
              ask again. The same control is in your account menu.
            </p>
            <div className="mt-4">
              <CookieSettingsButton />
            </div>
          </Section>

          <Section title="Erasure">
            <p>
              When an account is deleted, the person and their events are
              deleted from PostHog by the same process that removes them
              locally, and a nightly check retries any deletion that did not
              complete.
            </p>
          </Section>
        </article>
      </main>

      <footer className="px-6 pb-8">
        <p className="mx-auto max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
          ClientHQ is where agencies run their clients, projects, deliverables
          and invoices. Invited client contacts sign in here too, and land in
          their own portal.
        </p>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
