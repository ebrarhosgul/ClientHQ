import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * A section that has not shipped yet.
 *
 * The sidebar lists every path this product commits to (AC-23), including ones
 * whose feature is still to come. Those links are real rather than disabled,
 * because a dead control teaches nothing; this page is what makes that
 * honest, landing the reader inside the shell with an explanation rather than
 * on a bare 404.
 */
export default function AgencyNotFound() {
  return (
    <ErrorState
      className="my-auto"
      heading="Not here yet"
      description="This section has not been built yet, or the address is wrong. Everything that does exist is in the sidebar."
      action={
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      }
    />
  );
}
