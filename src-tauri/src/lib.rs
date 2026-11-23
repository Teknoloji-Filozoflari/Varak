mod backup;
mod commands;
mod cover;
mod db;
mod epub_meta;
mod hashutil;
mod metadata;
mod models;

use db::{ensure_defaults, open_db, DbState};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = db::default_data_dir();
    let conn = open_db(&data_dir).expect("Varak veritabanı açılamadı");
    ensure_defaults(&conn, &data_dir).expect("Varsayılan ayarlar yazılamadı");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(DbState {
            conn: Mutex::new(conn),
            data_dir,
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::get_book,
            commands::create_book,
            commands::update_book,
            commands::delete_book,
            commands::import_book_file,
            commands::preview_import,
            commands::confirm_import,
            commands::list_tags,
            commands::get_settings,
            commands::update_settings,
            commands::list_annotations,
            commands::add_annotation,
            commands::delete_annotation,
            commands::get_reading_position,
            commands::save_reading_position,
            commands::search_online_metadata,
            commands::apply_cover_from_url,
            commands::read_library_file,
            commands::read_library_file_b64,
            commands::extract_epub_cover,
            commands::attach_book_file,
            commands::create_backup,
            commands::inspect_backup,
            commands::restore_backup,
            commands::export_library_json,
            commands::export_library_csv,
            commands::get_statistics,
        ])
        .run(tauri::generate_context!())
        .expect("Varak başlatılamadı");
}
