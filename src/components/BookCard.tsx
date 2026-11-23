import type { CSSProperties } from "react";
import { assetUrl } from "../api";
import { STATUS_LABELS, type Book } from "../types";

interface Props {
  book: Book;
  onOpen: (book: Book) => void;
  style?: CSSProperties;
}

export function BookCard({ book, onOpen, style }: Props) {
  const cover = assetUrl(book.coverPath);
  return (
    <button className="book-card" onClick={() => onOpen(book)} style={style}>
      <div className="cover">
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <div className="cover-fallback">{book.title}</div>
        )}
      </div>
      <div className="book-meta">
        <h3>{book.title}</h3>
        <p>{book.author || "Yazar belirtilmemiş"}</p>
        <span className="badge">{STATUS_LABELS[book.status] || book.status}</span>
      </div>
    </button>
  );
}
