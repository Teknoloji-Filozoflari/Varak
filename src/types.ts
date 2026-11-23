export type BookStatus = "okunacak" | "okuyorum" | "okudum" | "yarim_biraktim";

export type FileType = "physical" | "pdf" | "epub";

export interface Book {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  status: BookStatus | string;
  rating: number | null;
  review: string | null;
  progress: number;
  coverPath: string | null;
  filePath: string | null;
  fileType: FileType | string;
  fileHash: string | null;
  pageCount: number | null;
  currentPage: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface BookInput {
  title: string;
  author?: string | null;
  isbn?: string | null;
  status?: string;
  rating?: number | null;
  review?: string | null;
  tags?: string[];
  coverPath?: string | null;
}

export interface BookUpdate {
  title?: string;
  author?: string | null;
  isbn?: string | null;
  status?: string;
  rating?: number | null;
  review?: string | null;
  progress?: number;
  currentPage?: number | null;
  pageCount?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  tags?: string[];
  coverPath?: string | null;
}

export interface BookFilter {
  query?: string | null;
  status?: string | null;
  tag?: string | null;
}

export interface Annotation {
  id: string;
  bookId: string;
  kind: string;
  content: string | null;
  color: string | null;
  locationJson: string;
  createdAt: string;
}

export interface AnnotationInput {
  bookId: string;
  kind: string;
  content?: string | null;
  color?: string | null;
  locationJson: string;
}

export interface ReadingPosition {
  bookId: string;
  positionJson: string;
  updatedAt: string;
}

export interface AppSettings {
  libraryFolder: string;
  theme: string;
}

export interface MetadataResult {
  title: string | null;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
  source: string;
}

export interface BackupFileEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface BackupManifest {
  format: string;
  version: number;
  appVersion: string;
  createdAt: string;
  bookCount: number;
  annotationCount: number;
  contents: string[];
  files: BackupFileEntry[];
}

export interface BackupConflict {
  incomingId: string;
  incomingTitle: string;
  reason: string;
  existingId: string | null;
  existingTitle: string | null;
}

export interface BackupPreview {
  path: string;
  manifest: BackupManifest;
  integrityOk: boolean;
  integrityErrors: string[];
  conflicts: BackupConflict[];
  compatible: boolean;
  compatibilityMessage: string | null;
}

export interface RestoreOptions {
  mode: "replace" | "merge" | string;
  conflictResolutions?: Record<string, string> | null;
}

export interface RestoreResult {
  mode: string;
  importedBooks: number;
  skipped: number;
  replaced: number;
  message: string;
}

export interface PeriodStat {
  period: string;
  booksFinished: number;
  pagesRead: number;
}

export interface LibraryStats {
  totalBooks: number;
  readBooks: number;
  readingBooks: number;
  toReadBooks: number;
  abandonedBooks: number;
  pagesRead: number;
  annotations: number;
  highlights: number;
  notes: number;
  bookmarks: number;
  monthly: PeriodStat[];
  yearly: PeriodStat[];
}

export interface DuplicateMatch {
  bookId: string;
  title: string;
  author: string | null;
  matchType: string;
}

export interface ImportPreview {
  path: string;
  title: string;
  author: string | null;
  isbn: string | null;
  fileType: string;
  fileHash: string;
  fileSize: number;
  duplicates: DuplicateMatch[];
  hasEmbeddedCover: boolean;
}

export interface ConfirmImport {
  path: string;
  title: string;
  author?: string | null;
  isbn?: string | null;
  importDespiteDuplicates: boolean;
}

export const STATUS_LABELS: Record<string, string> = {
  all: "Tümü",
  okunacak: "Okunacak",
  okuyorum: "Okuyorum",
  okudum: "Okudum",
  yarim_biraktim: "Yarım bıraktım",
};

export const STATUS_OPTIONS = [
  "okunacak",
  "okuyorum",
  "okudum",
  "yarim_biraktim",
] as const;
