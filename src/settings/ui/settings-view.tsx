import type { ReactNode } from "react";

import type { AgencySettings } from "@/db/tenant";
import { cn } from "@/ui/lib/cn";
import { PageHeader } from "@/ui/patterns/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";

import { addressLines, currencyLabel } from "../format";

export type SettingsViewProps = {
  /** `undefined` when there is no agency row to show. */
  readonly settings: AgencySettings | undefined;
};

/** One labelled value. A value that is not set says so in words. */
function Detail({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const NotSet = () => <span className="text-muted-foreground">Not set</span>;

/**
 * `/settings`: the agency's own profile, read only. Nothing here can be
 * changed yet; the page says so once, at the top, rather than showing controls
 * that do nothing.
 */
export function SettingsView({ settings }: SettingsViewProps) {
  if (settings === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Settings" />
        <p className="text-sm text-muted-foreground">
          Your agency&apos;s profile could not be loaded. Refresh the page, and
          if it still does not appear, contact support.
        </p>
      </div>
    );
  }

  const address = addressLines(settings);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Your agency's profile, as ClientHQ has it. This page is read only for now."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Agency profile</h2>
          </CardTitle>
          <CardDescription>Who your clients see you as.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Agency name">{settings.name}</Detail>
            <Detail label="Workspace address">{settings.slug}</Detail>
            <Detail label="About" className="sm:col-span-2">
              {settings.description ?? <NotSet />}
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Business details</h2>
          </CardTitle>
          <CardDescription>
            Where your agency is registered and how it invoices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Tax ID">{settings.taxId ?? <NotSet />}</Detail>
            <Detail label="Default currency">
              {currencyLabel(settings.defaultCurrency)}
            </Detail>
            <Detail label="Business address" className="sm:col-span-2">
              {address.length === 0 ? (
                <NotSet />
              ) : (
                <address className="not-italic">
                  {address.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              )}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
