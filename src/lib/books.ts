import type { Book } from "../types";

export function normalizeFileType(fileType: string | null | undefined): string {
  return (fileType || "").trim().toLowerCase();
}

export function isReadableBook(book: Book): boolean {
  const kind = normalizeFileType(book.fileType);
  return (kind === "pdf" || kind === "epub") && !!book.filePath?.trim();
}

/** Human-readable Turkish label for file type. */
export function fileTypeLabel(fileType: string | null | undefined): string {
  switch (normalizeFileType(fileType)) {
    case "pdf":
      return "PDF";
    case "epub":
      return "EPUB";
    case "physical":
      return "Fiziksel";
    default:
      return fileType || "bilinmiyor";
  }
}
