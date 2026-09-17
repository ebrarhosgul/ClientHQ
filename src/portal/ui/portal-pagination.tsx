import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/ui/primitives/pagination";

function hrefFor(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}?page=${page}`;
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

/**
 * Every portal list's pager: 25 rows a page, no filter to carry along, so one
 * component covers projects, files and invoices alike (spec 0014, AC-6, AC-8,
 * AC-9). Mirrors `src/invoices/ui/invoices-pagination.tsx`, without the
 * filter params that list alone needs.
 */
export function PortalPagination({
  basePath,
  page,
  pageCount,
}: {
  readonly basePath: string;
  readonly page: number;
  readonly pageCount: number;
}) {
  if (pageCount <= 1) {
    return undefined;
  }

  return (
    <Pagination>
      <PaginationContent>
        {page > 1 ? (
          <PaginationItem>
            <PaginationPrevious href={hrefFor(basePath, page - 1)} />
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
                href={hrefFor(basePath, entry)}
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
            <PaginationNext href={hrefFor(basePath, page + 1)} />
          </PaginationItem>
        ) : undefined}
      </PaginationContent>
    </Pagination>
  );
}
