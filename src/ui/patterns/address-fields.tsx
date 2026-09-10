import { cn } from "@/ui/lib/cn";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

/**
 * A postal address, first needed for a client's billing address (spec 0006).
 *
 * `names` carries the real form field name for each sub-field, so one caller
 * can post `billingAddressLine1` and a later one can post something else
 * without this component knowing or caring.
 */
export type AddressFieldValues = {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
};

export type AddressFieldsProps = {
  readonly legend: string;
  readonly names: AddressFieldValues;
  readonly values: AddressFieldValues;
  readonly fieldErrors?: Partial<
    Record<keyof AddressFieldValues, readonly string[]>
  >;
  readonly className?: string;
};

export function AddressFields({
  legend,
  names,
  values,
  fieldErrors,
  className,
}: AddressFieldsProps) {
  return (
    <fieldset className={cn("flex flex-col gap-4", className)}>
      <legend className="text-sm font-medium">{legend}</legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name={names.line1}
          label="Address line 1"
          className="sm:col-span-2"
          error={fieldErrors?.line1}
        >
          {(props) => (
            <Input
              {...props}
              name={names.line1}
              defaultValue={values.line1}
              autoComplete="address-line1"
              maxLength={200}
            />
          )}
        </Field>

        <Field
          name={names.line2}
          label="Address line 2"
          className="sm:col-span-2"
          error={fieldErrors?.line2}
        >
          {(props) => (
            <Input
              {...props}
              name={names.line2}
              defaultValue={values.line2}
              autoComplete="address-line2"
              maxLength={200}
            />
          )}
        </Field>

        <Field name={names.city} label="City" error={fieldErrors?.city}>
          {(props) => (
            <Input
              {...props}
              name={names.city}
              defaultValue={values.city}
              autoComplete="address-level2"
              maxLength={200}
            />
          )}
        </Field>

        <Field
          name={names.region}
          label="State or province"
          error={fieldErrors?.region}
        >
          {(props) => (
            <Input
              {...props}
              name={names.region}
              defaultValue={values.region}
              autoComplete="address-level1"
              maxLength={200}
            />
          )}
        </Field>

        <Field
          name={names.postalCode}
          label="Postal code"
          error={fieldErrors?.postalCode}
        >
          {(props) => (
            <Input
              {...props}
              name={names.postalCode}
              defaultValue={values.postalCode}
              autoComplete="postal-code"
              maxLength={20}
            />
          )}
        </Field>

        <Field
          name={names.country}
          label="Country"
          error={fieldErrors?.country}
        >
          {(props) => (
            <Input
              {...props}
              name={names.country}
              defaultValue={values.country}
              autoComplete="country-name"
              maxLength={200}
            />
          )}
        </Field>
      </div>
    </fieldset>
  );
}
