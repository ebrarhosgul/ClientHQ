import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/ui/primitives/pagination";

function hrefFor(
  page: number,
  status: string | undefined,
  clientId: string | undefined,
  includeVoid: boolean,
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));

  if (status) {
    params.set("status", status);
  }

  if (clientId) {
    params.set("client", clientId);
  }

  if (includeVoid) {
    params.set("void", "true");
  }

  return `/invoices?${params.toString()}`;
}

/** First, last, current, and one neighbour on each side; a gap fills the rest. */
function pageWindow(
  current: number,
  total: number,
): readonly (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const kept = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  return kept.flatMap((page, index) => {
    const previous = kept[index - 1];

    return previous !== undefined && page - previous > 1
      ? (["ellipsis", page] as const)
      : ([page] as const);
  });
}

/** 25 per page, every filter carried along (spec 0012, AC-10). */
export function InvoicesPagination({
  page,
  pageCount,
  status,
  clientId,
  includeVoid,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly status?: string;
  readonly clientId?: string;
  readonly includeVoid: boolean;
}) {
  if (pageCount <= 1) {
    return undefined;
  }

  return (
    <Pagination>
      <PaginationContent>
        {page > 1 ? (
          <PaginationItem>
            <PaginationPrevious
              href={hrefFor(page - 1, status, clientId, includeVoid)}
            />
          </PaginationItem>
        ) : undefined}

        {pageWindow(page, pageCount).map((entry, index) =>
          entry === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={entry}>
              <PaginationLink
                href={hrefFor(entry, status, clientId, includeVoid)}
                isActive={entry === page}
                aria-label={`Page ${entry}`}
              >
                {entry}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        {page < pageCount ? (
          <PaginationItem>
            <PaginationNext
              href={hrefFor(page + 1, status, clientId, includeVoid)}
            />
          </PaginationItem>
        ) : undefined}
      </PaginationContent>
    </Pagination>
  );
}
