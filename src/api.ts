import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  Annotation,
  AnnotationInput,
  AppSettings,
  BackupManifest,
  BackupPreview,
  Book,
  BookFilter,
  BookInput,
  BookUpdate,
  ConfirmImport,
  ImportPreview,
  LibraryStats,
  MetadataResult,
  ReadingPosition,
  RestoreOptions,
  RestoreResult,
} from "./types";

export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export const api = {
  listBooks: (filter: BookFilter = {}) =>
    invoke<Book[]>("list_books", { filter }),
  getBook: (id: string) => invoke<Book | null>("get_book", { id }),
  createBook: (input: BookInput) => invoke<Book>("create_book", { input }),
  updateBook: (id: string, input: BookUpdate) =>
    invoke<Book>("update_book", { id, input }),
  deleteBook: (id: string) => invoke<void>("delete_book", { id }),
  importBookFile: (path: string, title?: string, author?: string) =>
    invoke<Book>("import_book_file", { path, title, author }),
  previewImport: (path: string) =>
    invoke<ImportPreview>("preview_import", { path }),
  confirmImport: (input: ConfirmImport) =>
    invoke<Book>("confirm_import", { input }),
  listTags: () => invoke<string[]>("list_tags"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (libraryFolder?: string, theme?: string) =>
    invoke<AppSettings>("update_settings", { libraryFolder, theme }),
  listAnnotations: (bookId: string) =>
    invoke<Annotation[]>("list_annotations", { bookId }),
  addAnnotation: (input: AnnotationInput) =>
    invoke<Annotation>("add_annotation", { input }),
  deleteAnnotation: (id: string) => invoke<void>("delete_annotation", { id }),
  getReadingPosition: (bookId: string) =>
    invoke<ReadingPosition | null>("get_reading_position", { bookId }),
  saveReadingPosition: (bookId: string, positionJson: string) =>
    invoke<ReadingPosition>("save_reading_position", { bookId, positionJson }),
  searchOnlineMetadata: (query: string, isbn?: string) =>
    invoke<MetadataResult[]>("search_online_metadata", { query, isbn }),
  applyCoverFromUrl: (bookId: string, url: string) =>
    invoke<Book>("apply_cover_from_url", { bookId, url }),
  readLibraryFile: (path: string) =>
    invoke<number[]>("read_library_file", { path }),
  extractEpubCover: (id: string) => invoke<Book>("extract_epub_cover", { id }),
  attachBookFile: (id: string, path: string) =>
    invoke<Book>("attach_book_file", { id, path }),
  createBackup: (destPath: string) =>
    invoke<BackupManifest>("create_backup", { destPath }),
  inspectBackup: (path: string) =>
    invoke<BackupPreview>("inspect_backup", { path }),
  restoreBackup: (path: string, options: RestoreOptions) =>
    invoke<RestoreResult>("restore_backup", { path, options }),
  exportLibraryJson: (destPath: string) =>
    invoke<void>("export_library_json", { destPath }),
  exportLibraryCsv: (destPath: string) =>
    invoke<void>("export_library_csv", { destPath }),
  getStatistics: () => invoke<LibraryStats>("get_statistics"),
};

export async function fileToBlobUrl(
  path: string,
  mime: string,
): Promise<string> {
  const bytes = await api.readLibraryFile(path);
  const buffer = new Uint8Array(bytes);
  const blob = new Blob([buffer], { type: mime });
  return URL.createObjectURL(blob);
}
