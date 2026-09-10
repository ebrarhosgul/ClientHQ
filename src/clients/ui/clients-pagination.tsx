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
  archived: boolean,
  search: string | undefined,
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));

  if (search) {
    params.set("q", search);
  }

  if (archived) {
    params.set("archived", "true");
  }

  return `/clients?${params.toString()}`;
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

export function ClientsPagination({
  page,
  pageCount,
  archived,
  search,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly archived: boolean;
  readonly search?: string;
}) {
  if (pageCount <= 1) {
    return undefined;
  }

  return (
    <Pagination>
      <PaginationContent>
        {page > 1 ? (
          <PaginationItem>
            <PaginationPrevious href={hrefFor(page - 1, archived, search)} />
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
                href={hrefFor(entry, archived, search)}
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
            <PaginationNext href={hrefFor(page + 1, archived, search)} />
          </PaginationItem>
        ) : undefined}
      </PaginationContent>
    </Pagination>
  );
}
