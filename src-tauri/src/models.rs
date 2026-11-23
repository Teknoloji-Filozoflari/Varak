use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileType {
    Physical,
    Pdf,
    Epub,
}

impl FileType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Physical => "physical",
            Self::Pdf => "pdf",
            Self::Epub => "epub",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub status: String,
    pub rating: Option<i32>,
    pub review: Option<String>,
    pub progress: f64,
    pub cover_path: Option<String>,
    pub file_path: Option<String>,
    pub file_type: String,
    pub file_hash: Option<String>,
    pub page_count: Option<i32>,
    pub current_page: Option<i32>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookInput {
    pub title: String,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub status: Option<String>,
    pub rating: Option<i32>,
    pub review: Option<String>,
    pub tags: Option<Vec<String>>,
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookUpdate {
    pub title: Option<String>,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub status: Option<String>,
    pub rating: Option<i32>,
    pub review: Option<String>,
    pub progress: Option<f64>,
    pub current_page: Option<i32>,
    pub page_count: Option<i32>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub tags: Option<Vec<String>>,
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFilter {
    pub query: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    pub kind: String,
    pub content: Option<String>,
    pub color: Option<String>,
    pub location_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    pub book_id: String,
    pub kind: String,
    pub content: Option<String>,
    pub color: Option<String>,
    pub location_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    pub book_id: String,
    pub position_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub library_folder: String,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataResult {
    pub title: Option<String>,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub cover_url: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: String,
    pub book_count: usize,
    pub annotation_count: usize,
    pub contents: Vec<String>,
    pub files: Vec<BackupFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileEntry {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub path: String,
    pub manifest: BackupManifest,
    pub integrity_ok: bool,
    pub integrity_errors: Vec<String>,
    pub conflicts: Vec<BackupConflict>,
    pub compatible: bool,
    pub compatibility_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConflict {
    pub incoming_id: String,
    pub incoming_title: String,
    pub reason: String,
    pub existing_id: Option<String>,
    pub existing_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptions {
    pub mode: String, // "replace" | "merge"
    /// For merge conflicts: "skip" | "keep_local" | "take_incoming"
    pub conflict_resolutions: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub mode: String,
    pub imported_books: usize,
    pub skipped: usize,
    pub replaced: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total_books: usize,
    pub read_books: usize,
    pub reading_books: usize,
    pub to_read_books: usize,
    pub abandoned_books: usize,
    pub pages_read: i64,
    pub annotations: usize,
    pub highlights: usize,
    pub notes: usize,
    pub bookmarks: usize,
    pub monthly: Vec<PeriodStat>,
    pub yearly: Vec<PeriodStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStat {
    pub period: String,
    pub books_finished: usize,
    pub pages_read: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMatch {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub match_type: String, // "isbn" | "file_hash"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub path: String,
    pub title: String,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub file_type: String,
    pub file_hash: String,
    pub file_size: u64,
    pub duplicates: Vec<DuplicateMatch>,
    pub has_embedded_cover: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmImport {
    pub path: String,
    pub title: String,
    pub author: Option<String>,
    pub isbn: Option<String>,
    /// Required when duplicates exist — user explicitly continues
    pub import_despite_duplicates: bool,
}
