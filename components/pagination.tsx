import Link from "next/link";

type PaginationProps = {
  path: string;
  page: number;
  hasNext: boolean;
  query?: Record<string, string | undefined>;
};

function href(path: string, page: number, query: PaginationProps["query"]) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function Pagination({ path, page, hasNext, query }: PaginationProps) {
  if (page === 1 && !hasNext) return null;
  return <nav className="pagination" aria-label="Table pages">
    {page > 1 ? <Link className="secondary-button" href={href(path, page - 1, query)}>Previous</Link> : <span />}
    <span>Page {page}</span>
    {hasNext ? <Link className="secondary-button" href={href(path, page + 1, query)}>Next</Link> : <span />}
  </nav>;
}
