import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * Nothing at this address.
 *
 * The same shared error state as every other failure, with its own words: a
 * missing page is not a broken one, and telling someone "something went wrong"
 * when they mistyped a URL sends them looking for a fault that is not there.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <ErrorState
        className="w-full max-w-md"
        heading="Page not found"
        description="This address does not lead anywhere. It may have moved, or the link that brought you here may be out of date."
        action={
          <Button asChild>
            <Link href="/">Go to the start</Link>
          </Button>
        }
      />
    </main>
  );
}
