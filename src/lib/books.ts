import type { Book } from "../types";

export function normalizeFileType(fileType: string | null | undefined): string {
  return (fileType || "").trim().toLowerCase();
}

export function isReadableBook(book: Book): boolean {
  const kind = normalizeFileType(book.fileType);
  return (kind === "pdf" || kind === "epub") && !!book.filePath;
}
