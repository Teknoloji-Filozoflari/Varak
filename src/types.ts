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
