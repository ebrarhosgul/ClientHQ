import type { MembershipRole } from "@/db/schema";

export type AgencyWelcomeProps = {
  readonly name: string;
  readonly role: MembershipRole;
  readonly currency: string;
};

/**
 * The panel that proves the whole thread works.
 *
 * The name comes from this database's own `organizations` row, reached through
 * the tenant layer with the organization the Clerk session named (spec 0005,
 * AC-15). That is the only thing on any screen in the product so far that could
 * not be rendered without a real server side tenant context, which is why it is
 * here rather than read from a Clerk client hook: a hook would show the same
 * word and prove nothing.
 *
 * The role is the Clerk session claim, the authoritative one. `memberships.role`
 * is a display mirror that no decision reads.
 */
export function AgencyWelcome({ name, role, currency }: AgencyWelcomeProps) {
  return (
    <section
      aria-labelledby="agency-welcome-heading"
      className="rounded-lg border border-border bg-card p-6 text-card-foreground"
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        You are acting as
      </p>
      <h2
        id="agency-welcome-heading"
        className="mt-1 text-xl font-semibold tracking-tight"
      >
        {name}
      </h2>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Everything you create in ClientHQ belongs to this agency. Clients,
        projects, deliverables and invoices are scoped to it, and no other
        agency on the platform can reach them.
      </p>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Your role here</dt>
          <dd className="mt-0.5 text-sm font-medium">
            {role === "admin" ? "Admin" : "Member"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Invoice currency</dt>
          <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums">
            {currency}
          </dd>
        </div>
      </dl>
    </section>
  );
}
