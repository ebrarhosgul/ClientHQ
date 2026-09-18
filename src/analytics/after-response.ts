/**
 * Queue work for after the response, wherever the caller happens to be.
 *
 * `after()` from `next/server` only exists inside a request: a Server
 * Component render, a Server Action, a route handler, the proxy. Outside one
 * (a unit test rendering a page, a script) it throws, and the work runs right
 * away instead. Either way a caller never has to know which, and observability
 * never has a reason to throw into a render (spec 0019, AC-21).
 */
import { after } from "next/server";

export function afterResponse(task: () => void | Promise<void>): void {
  try {
    after(task);
  } catch {
    void Promise.resolve()
      .then(task)
      .catch(() => undefined);
  }
}
