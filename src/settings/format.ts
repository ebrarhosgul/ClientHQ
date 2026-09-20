/**
 * How the agency's business profile reads on `/settings`. Pure, so the rules
 * for a half filled address are tested without rendering anything.
 */
import type { AgencySettings } from "@/db/tenant";

/** Text with nothing in it is the same as no text. */
const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

/**
 * The postal address as printed lines, top to bottom, leaving out whatever is
 * not set: street lines, then `city, region postal code`, then the country.
 * An empty result means no address has been entered at all.
 */
export function addressLines(
  settings: Pick<
    AgencySettings,
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "region"
    | "postalCode"
    | "country"
  >,
): readonly string[] {
  const regionAndPostalCode = [
    present(settings.region),
    present(settings.postalCode),
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");

  const cityLine = [present(settings.city), present(regionAndPostalCode)]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  return [
    present(settings.addressLine1),
    present(settings.addressLine2),
    present(cityLine),
    present(settings.country),
  ].filter((line): line is string => line !== undefined);
}

/**
 * `US dollar (USD)` for a code the runtime knows, the bare code for one it
 * does not, so an unfamiliar currency still shows what is stored.
 */
export function currencyLabel(code: string): string {
  const name = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "currency" }).of(code);
    } catch {
      return undefined;
    }
  })();

  return name === undefined || name === code ? code : `${name} (${code})`;
}
