use crate::db::{self, DbError, DbState};
use crate::metadata::{self, MetaError};
use crate::models::{
    Annotation, AnnotationInput, AppSettings, Book, BookFilter, BookInput, BookUpdate,
    MetadataResult, ReadingPosition,
};
use tauri::State;

#[tauri::command]
pub fn list_books(state: State<DbState>, filter: BookFilter) -> Result<Vec<Book>, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::list_books(&conn, filter)
}

#[tauri::command]
pub fn get_book(state: State<DbState>, id: String) -> Result<Option<Book>, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::get_book(&conn, &id)
}

#[tauri::command]
pub fn create_book(state: State<DbState>, input: BookInput) -> Result<Book, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::create_book(&conn, input)
}

#[tauri::command]
pub fn update_book(
    state: State<DbState>,
    id: String,
    input: BookUpdate,
) -> Result<Book, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::update_book(&conn, &id, input)
}

#[tauri::command]
pub fn delete_book(state: State<DbState>, id: String) -> Result<(), DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::delete_book(&conn, &id)
}

#[tauri::command]
pub fn import_book_file(
    state: State<DbState>,
    path: String,
    title: Option<String>,
    author: Option<String>,
) -> Result<Book, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::import_file(&conn, &path, title, author)
}

#[tauri::command]
pub fn list_tags(state: State<DbState>) -> Result<Vec<String>, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::list_tags(&conn)
}

#[tauri::command]
pub fn get_settings(state: State<DbState>) -> Result<AppSettings, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::get_settings(&conn, &state.data_dir)
}

#[tauri::command]
pub fn update_settings(
    state: State<DbState>,
    library_folder: Option<String>,
    theme: Option<String>,
) -> Result<AppSettings, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::update_settings(&conn, library_folder, theme)
}

#[tauri::command]
pub fn list_annotations(
    state: State<DbState>,
    book_id: String,
) -> Result<Vec<Annotation>, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::list_annotations(&conn, &book_id)
}

#[tauri::command]
pub fn add_annotation(
    state: State<DbState>,
    input: AnnotationInput,
) -> Result<Annotation, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::add_annotation(&conn, input)
}

#[tauri::command]
pub fn delete_annotation(state: State<DbState>, id: String) -> Result<(), DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::delete_annotation(&conn, &id)
}

#[tauri::command]
pub fn get_reading_position(
    state: State<DbState>,
    book_id: String,
) -> Result<Option<ReadingPosition>, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::get_position(&conn, &book_id)
}

#[tauri::command]
pub fn save_reading_position(
    state: State<DbState>,
    book_id: String,
    position_json: String,
) -> Result<ReadingPosition, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::save_position(&conn, &book_id, &position_json)
}

#[tauri::command]
pub async fn search_online_metadata(
    query: String,
    isbn: Option<String>,
) -> Result<Vec<MetadataResult>, MetaError> {
    metadata::search_metadata(query, isbn).await
}

#[tauri::command]
pub async fn apply_cover_from_url(
    state: State<'_, DbState>,
    book_id: String,
    url: String,
) -> Result<Book, MetaError> {
    let (bytes, ext) = metadata::download_cover(&url).await?;
    let conn = state
        .conn
        .lock()
        .map_err(|e| MetaError::Message(e.to_string()))?;
    db::save_cover_bytes(&conn, &book_id, &bytes, &ext).map_err(|e| MetaError::Message(e.to_string()))
}

#[tauri::command]
pub fn read_library_file(path: String) -> Result<Vec<u8>, DbError> {
    std::fs::read(&path).map_err(DbError::from)
}

#[tauri::command]
pub fn extract_epub_cover(state: State<DbState>, id: String) -> Result<Book, DbError> {
    let conn = state.conn.lock().map_err(|e| DbError::Message(e.to_string()))?;
    db::extract_cover_from_epub(&conn, &id)
}
