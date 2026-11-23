import type { CSSProperties, MouseEvent } from "react";
import { assetUrl } from "../api";
import { isReadableBook } from "../lib/books";
import { STATUS_LABELS, type Book } from "../types";

interface Props {
  book: Book;
  onOpen: (book: Book) => void;
  onRead?: (book: Book) => void;
  style?: CSSProperties;
}

export function BookCard({ book, onOpen, onRead, style }: Props) {
  const cover = assetUrl(book.coverPath);
  const readable = isReadableBook(book);

  function handleRead(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onRead?.(book);
  }

  return (
    <div className="book-card-wrap" style={style}>
      <button type="button" className="book-card" onClick={() => onOpen(book)}>
        <div className="cover">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <div className="cover-fallback">{book.title}</div>
          )}
          {readable && <span className="cover-kind">{book.fileType.toUpperCase()}</span>}
        </div>
        <div className="book-meta">
          <h3>{book.title}</h3>
          <p>{book.author || "Yazar belirtilmemiş"}</p>
          <span className="badge">{STATUS_LABELS[book.status] || book.status}</span>
        </div>
      </button>
      {readable && onRead && (
        <button type="button" className="btn btn-primary book-card-read" onClick={handleRead}>
          Oku
        </button>
      )}
    </div>
  );
}
