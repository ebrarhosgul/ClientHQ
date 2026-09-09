import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";

import { isClerkConfigured } from "@/lib/env";
import { Toaster } from "@/ui/primitives/sonner";
import { IdentityProvider } from "@/ui/shell/identity";
import { readStoredTheme, THEME_COOKIE } from "@/ui/theme";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ClientHQ",
    template: "%s · ClientHQ",
  },
  description:
    "A portal where agencies manage their clients, projects, deliverables and invoices.",
};

/**
 * The document.
 *
 * The theme is decided here, on the server, and painted in the first frame.
 * There is no blocking script and no client side flash: when the cookie says
 * light or dark, `data-theme` is stamped and the matching block in
 * `globals.css` wins; when there is no cookie, nothing is stamped and the
 * `prefers-color-scheme` block decides, so changing the operating system
 * setting changes the page with no reload (AC-8, AC-9).
 *
 * Reading a cookie makes every route dynamic. Spec 0004 accepts that: the whole
 * product sits behind a session anyway, so there was nothing to render at build
 * time.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = readStoredTheme((await cookies()).get(THEME_COOKIE)?.value);
  const clerkLive = isClerkConfigured();

  const tree = (
    <>
      {children}
      <Toaster />
    </>
  );

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${jetBrainsMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          Clerk wraps the whole tree so the shell's client components can read
          identity through its hooks. Spec 0003 keeps the server side `auth()`
          in exactly one file, and the chrome never touches it (invariant 2).

          Only when there is a publishable key: `ClerkProvider` throws without
          one, and the browser suite in CI deliberately runs with no provider
          credential. `IdentityProvider` carries the answer down so the shell
          renders its signed out state instead of crashing.
        */}
        <IdentityProvider clerkLive={clerkLive}>
          {clerkLive ? <ClerkProvider>{tree}</ClerkProvider> : tree}
        </IdentityProvider>
      </body>
    </html>
  );
}
