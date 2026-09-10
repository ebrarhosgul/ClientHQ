/**
 * covers: spec 0006 AC-4
 *
 * The page number control: absent for a single page, Previous/Next hidden at
 * the ends, an ellipsis once there are too many pages to show every number,
 * and every link carrying the current search and archived filter along.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientsPagination } from "./clients-pagination";

describe("ClientsPagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(
      <ClientsPagination page={1} pageCount={1} archived={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("hides Previous on the first page and shows Next", () => {
    render(<ClientsPagination page={1} pageCount={3} archived={false} />);

    expect(
      screen.queryByRole("link", { name: "Go to previous page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to next page" }),
    ).toBeInTheDocument();
  });

  it("hides Next on the last page and shows Previous", () => {
    render(<ClientsPagination page={3} pageCount={3} archived={false} />);

    expect(
      screen.getByRole("link", { name: "Go to previous page" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Go to next page" }),
    ).not.toBeInTheDocument();
  });

  it("shows every page number when there are 7 or fewer", () => {
    render(<ClientsPagination page={2} pageCount={7} archived={false} />);

    for (const page of [1, 2, 3, 4, 5, 6, 7]) {
      expect(
        screen.getByRole("link", { name: `Page ${page}` }),
      ).toBeInTheDocument();
    }
  });

  it("marks the current page current, and no other", () => {
    render(<ClientsPagination page={2} pageCount={3} archived={false} />);

    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Page 1" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("collapses distant pages behind an ellipsis once there are too many", () => {
    render(<ClientsPagination page={5} pageCount={10} archived={false} />);

    for (const page of [1, 4, 5, 6, 10]) {
      expect(
        screen.getByRole("link", { name: `Page ${page}` }),
      ).toBeInTheDocument();
    }
    for (const page of [2, 3, 7, 8, 9]) {
      expect(
        screen.queryByRole("link", { name: `Page ${page}` }),
      ).not.toBeInTheDocument();
    }
  });

  it("carries the search and archived filter on every page link", () => {
    render(<ClientsPagination page={1} pageCount={3} archived search="ada" />);

    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "href",
      "/clients?page=2&q=ada&archived=true",
    );
  });
});
