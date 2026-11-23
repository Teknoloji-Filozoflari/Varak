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
