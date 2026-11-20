/** Breadcrumb tail for `/audiobooks/:id`: "Audiobooks / <book title>". */

import { Link } from "react-router-dom";

import { useBook } from "@/lib/audiobook-queries";

export function BookCrumb({ id }: { id: string }) {
  const { data: book } = useBook(id);
  return (
    <>
      <span aria-hidden="true">/</span>
      <Link to="/audiobooks" className="hover:text-foreground">
        Audiobooks
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-foreground max-w-64 truncate font-medium">{book?.title ?? "…"}</span>
    </>
  );
}
