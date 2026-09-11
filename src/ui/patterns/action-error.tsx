import Link from "next/link";

import type { ActionError } from "@/db/tenant/errors";

import { errorMessage } from "./error-messages";

export type ActionErrorMessageProps = {
  readonly error: ActionError;
};

/**
 * The sentence for a failed Server Action, plus the one link a code can earn.
 *
 * `subscription_inactive` is the only code whose fix lives on a page of its
 * own, so it is the only one that gets a link (spec 0008, AC-7). Every form
 * renders its failure through this rather than through `errorMessage()`
 * directly, so a code added later that needs a way out gets one here, once.
 *
 * Inline content only: the caller owns the alert or the paragraph it sits in.
 */
export function ActionErrorMessage({ error }: ActionErrorMessageProps) {
  return (
    <>
      {errorMessage(error)}
      {error.code === "subscription_inactive" ? (
        <>
          {" "}
          <Link
            href="/billing"
            className="font-medium underline underline-offset-2"
          >
            Go to billing
          </Link>
        </>
      ) : undefined}
    </>
  );
}
