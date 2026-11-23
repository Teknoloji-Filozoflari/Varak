use crate::db::{self, DbError, DbState};
use crate::hashutil::{sha256_bytes, sha256_file};
use crate::models::{
    BackupConflict, BackupFileEntry, BackupManifest, BackupPreview, Book, RestoreOptions,
    RestoreResult,
};
use chrono::Utc;
use rusqlite::Connection;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const BACKUP_FORMAT: &str = "varak-backup";
pub const BACKUP_VERSION: u32 = 1;
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

fn err(msg: impl Into<String>) -> DbError {
    DbError::Message(msg.into())
}

pub fn create_backup(state: &DbState, dest_path: &str) -> Result<BackupManifest, DbError> {
    let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
    let settings = db::get_settings(&conn, &state.data_dir)?;
    let library = PathBuf::from(&settings.library_folder);
    let db_path = state.data_dir.join("varak.db");

    // Checkpoint so the on-disk DB is consistent
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");

    let staging = state.data_dir.join(format!(".backup-staging-{}", UuidLite::new()));
    fs::create_dir_all(&staging)?;
    let result = (|| {
        let staged_db = staging.join("varak.db");
        fs::copy(&db_path, &staged_db)?;

        let books = db::list_books(
            &conn,
            crate::models::BookFilter {
                query: None,
                status: None,
                tag: None,
            },
        )?;
        let annotation_count = count_annotations(&conn)?;

        let mut files: Vec<BackupFileEntry> = Vec::new();
        let mut zip_entries: Vec<(String, PathBuf)> = Vec::new();

        add_file_entry("data/varak.db", &staged_db, &mut files, &mut zip_entries)?;

        for book in &books {
            if let Some(fp) = &book.file_path {
                let src = PathBuf::from(fp);
                if src.exists() {
                    let name = src
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("book.bin");
                    let rel = format!("files/{name}");
                    add_file_entry(&rel, &src, &mut files, &mut zip_entries)?;
                }
            }
            if let Some(cp) = &book.cover_path {
                let src = PathBuf::from(cp);
                if src.exists() {
                    let name = src
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("cover.bin");
                    let rel = format!("covers/{name}");
                    add_file_entry(&rel, &src, &mut files, &mut zip_entries)?;
                }
            }
        }

        // Also include any leftover covers/files under library for completeness
        collect_dir_files(&library, "files", &["pdf", "epub"], &mut files, &mut zip_entries)?;
        collect_dir_files(
            &library.join("covers"),
            "covers",
            &["jpg", "jpeg", "png", "webp", "gif"],
            &mut files,
            &mut zip_entries,
        )?;

        let json_export = staging.join("library.json");
        write_json_export(&conn, &json_export)?;
        add_file_entry(
            "export/library.json",
            &json_export,
            &mut files,
            &mut zip_entries,
        )?;

        let csv_export = staging.join("library.csv");
        write_csv_export(&conn, &csv_export)?;
        add_file_entry(
            "export/library.csv",
            &csv_export,
            &mut files,
            &mut zip_entries,
        )?;

        let manifest = BackupManifest {
            format: BACKUP_FORMAT.into(),
            version: BACKUP_VERSION,
            app_version: APP_VERSION.into(),
            created_at: Utc::now().to_rfc3339(),
            book_count: books.len(),
            annotation_count,
            contents: vec![
                "database".into(),
                "library_files".into(),
                "covers".into(),
                "annotations".into(),
                "reading_positions".into(),
                "settings".into(),
                "json_export".into(),
                "csv_export".into(),
            ],
            files: files.clone(),
        };
        let manifest_path = staging.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).map_err(|e| err(e.to_string()))?,
        )?;
        // Manifest itself is listed without self-hash circularity — verified as present + parseable

        let dest = PathBuf::from(dest_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = File::create(&dest)?;
        let mut zip = ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file("manifest.json", opts)
            .map_err(|e| err(e.to_string()))?;
        zip.write_all(&fs::read(&manifest_path)?)
            .map_err(|e| err(e.to_string()))?;

        let mut seen = std::collections::HashSet::new();
        for (rel, path) in &zip_entries {
            if !seen.insert(rel.clone()) {
                continue;
            }
            zip.start_file(rel, opts).map_err(|e| err(e.to_string()))?;
            let mut f = File::open(path)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            zip.write_all(&buf).map_err(|e| err(e.to_string()))?;
        }
        zip.finish().map_err(|e| err(e.to_string()))?;
        Ok(manifest)
    })();

    let _ = fs::remove_dir_all(&staging);
    result
}

fn add_file_entry(
    rel: &str,
    path: &Path,
    files: &mut Vec<BackupFileEntry>,
    zip_entries: &mut Vec<(String, PathBuf)>,
) -> Result<(), DbError> {
    if files.iter().any(|f| f.path == rel) {
        return Ok(());
    }
    let meta = fs::metadata(path)?;
    let hash = sha256_file(path).map_err(err)?;
    files.push(BackupFileEntry {
        path: rel.to_string(),
        sha256: hash,
        bytes: meta.len(),
    });
    zip_entries.push((rel.to_string(), path.to_path_buf()));
    Ok(())
}

fn collect_dir_files(
    dir: &Path,
    prefix: &str,
    exts: &[&str],
    files: &mut Vec<BackupFileEntry>,
    zip_entries: &mut Vec<(String, PathBuf)>,
) -> Result<(), DbError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !exts.contains(&ext.as_str()) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file.bin");
        let rel = format!("{prefix}/{name}");
        add_file_entry(&rel, &path, files, zip_entries)?;
    }
    Ok(())
}

fn count_annotations(conn: &Connection) -> Result<usize, DbError> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))?;
    Ok(n as usize)
}

pub fn write_json_export(conn: &Connection, dest: &Path) -> Result<(), DbError> {
    let books = db::list_books(
        conn,
        crate::models::BookFilter {
            query: None,
            status: None,
            tag: None,
        },
    )?;
    let mut annotations = Vec::new();
    let mut positions = Vec::new();
    for b in &books {
        annotations.extend(db::list_annotations(conn, &b.id)?);
        if let Some(p) = db::get_position(conn, &b.id)? {
            positions.push(p);
        }
    }
    let tags = db::list_tags(conn)?;
    let settings = db::get_settings(conn, &db::default_data_dir())?;
    let payload = serde_json::json!({
        "format": "varak-library-json",
        "version": BACKUP_VERSION,
        "exportedAt": Utc::now().to_rfc3339(),
        "settings": settings,
        "tags": tags,
        "books": books,
        "annotations": annotations,
        "readingPositions": positions,
    });
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        dest,
        serde_json::to_string_pretty(&payload).map_err(|e| err(e.to_string()))?,
    )?;
    Ok(())
}

pub fn write_csv_export(conn: &Connection, dest: &Path) -> Result<(), DbError> {
    let books = db::list_books(
        conn,
        crate::models::BookFilter {
            query: None,
            status: None,
            tag: None,
        },
    )?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut wtr = csv::Writer::from_path(dest).map_err(|e| err(e.to_string()))?;
    wtr.write_record([
        "id",
        "title",
        "author",
        "isbn",
        "status",
        "rating",
        "review",
        "progress",
        "file_type",
        "file_hash",
        "page_count",
        "current_page",
        "started_at",
        "finished_at",
        "tags",
        "created_at",
        "updated_at",
    ])
    .map_err(|e| err(e.to_string()))?;
    for b in books {
        wtr.write_record([
            b.id,
            b.title,
            b.author.unwrap_or_default(),
            b.isbn.unwrap_or_default(),
            b.status,
            b.rating.map(|r| r.to_string()).unwrap_or_default(),
            b.review.unwrap_or_default(),
            b.progress.to_string(),
            b.file_type,
            b.file_hash.unwrap_or_default(),
            b.page_count.map(|p| p.to_string()).unwrap_or_default(),
            b.current_page.map(|p| p.to_string()).unwrap_or_default(),
            b.started_at.unwrap_or_default(),
            b.finished_at.unwrap_or_default(),
            b.tags.join(";"),
            b.created_at,
            b.updated_at,
        ])
        .map_err(|e| err(e.to_string()))?;
    }
    wtr.flush().map_err(|e| err(e.to_string()))?;
    Ok(())
}

pub fn export_json(state: &DbState, dest: &str) -> Result<(), DbError> {
    let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
    write_json_export(&conn, Path::new(dest))
}

pub fn export_csv(state: &DbState, dest: &str) -> Result<(), DbError> {
    let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
    write_csv_export(&conn, Path::new(dest))
}

pub fn inspect_backup(state: &DbState, path: &str) -> Result<BackupPreview, DbError> {
    let extract_dir = state
        .data_dir
        .join(format!(".inspect-{}", UuidLite::new()));
    fs::create_dir_all(&extract_dir)?;
    let result = (|| {
        unzip_to(Path::new(path), &extract_dir)?;
        let manifest = read_manifest(&extract_dir)?;
        let (compatible, compatibility_message) = check_compatible(&manifest);
        let (integrity_ok, integrity_errors) = verify_integrity(&extract_dir, &manifest);

        let mut conflicts = Vec::new();
        if compatible && integrity_ok {
            let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
            let staged_db = extract_dir.join("data/varak.db");
            if staged_db.exists() {
                conflicts = find_conflicts(&conn, &staged_db)?;
            }
        }

        Ok(BackupPreview {
            path: path.to_string(),
            manifest,
            integrity_ok,
            integrity_errors,
            conflicts,
            compatible,
            compatibility_message,
        })
    })();
    let _ = fs::remove_dir_all(&extract_dir);
    result
}

fn check_compatible(manifest: &BackupManifest) -> (bool, Option<String>) {
    if manifest.format != BACKUP_FORMAT {
        return (
            false,
            Some(format!(
                "Desteklenmeyen yedek formatı: {} (beklenen: {})",
                manifest.format, BACKUP_FORMAT
            )),
        );
    }
    if manifest.version > BACKUP_VERSION {
        return (
            false,
            Some(format!(
                "Yedek sürümü ({}) bu Varak sürümünden ({}) yeni. Uygulamayı güncelleyin.",
                manifest.version, BACKUP_VERSION
            )),
        );
    }
    if manifest.version < 1 {
        return (false, Some("Geçersiz yedek sürümü.".into()));
    }
    (true, None)
}

fn read_manifest(dir: &Path) -> Result<BackupManifest, DbError> {
    let path = dir.join("manifest.json");
    if !path.exists() {
        return Err(err("Yedekte manifest.json yok"));
    }
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|e| err(format!("Manifest okunamadı: {e}")))
}

fn verify_integrity(dir: &Path, manifest: &BackupManifest) -> (bool, Vec<String>) {
    let mut errors = Vec::new();
    for entry in &manifest.files {
        let path = dir.join(&entry.path);
        if !path.exists() {
            errors.push(format!("Eksik dosya: {}", entry.path));
            continue;
        }
        match sha256_file(&path) {
            Ok(hash) if hash != entry.sha256 => {
                errors.push(format!(
                    "Bütünlük hatası: {} (beklenen {}, bulunan {})",
                    entry.path, entry.sha256, hash
                ));
            }
            Ok(_) => {}
            Err(e) => errors.push(format!("{} okunamadı: {e}", entry.path)),
        }
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() != entry.bytes {
                errors.push(format!(
                    "Boyut uyuşmazlığı: {} (beklenen {}, bulunan {})",
                    entry.path,
                    entry.bytes,
                    meta.len()
                ));
            }
        }
    }
    (errors.is_empty(), errors)
}

fn find_conflicts(live: &Connection, backup_db: &Path) -> Result<Vec<BackupConflict>, DbError> {
    let bconn = Connection::open(backup_db)?;
    let mut stmt = bconn.prepare(
        "SELECT id, title, isbn, IFNULL(file_hash,'') FROM books ORDER BY title COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut conflicts = Vec::new();
    for (id, title, isbn, hash) in rows {
        if let Some(existing) = db::get_book(live, &id)? {
            conflicts.push(BackupConflict {
                incoming_id: id.clone(),
                incoming_title: title.clone(),
                reason: "Aynı kimlik (id)".into(),
                existing_id: Some(existing.id),
                existing_title: Some(existing.title),
            });
            continue;
        }
        if let Some(isbn) = isbn.as_ref().filter(|s| !s.trim().is_empty()) {
            if let Some(existing) = db::find_by_isbn(live, isbn)? {
                if existing.id != id {
                    conflicts.push(BackupConflict {
                        incoming_id: id.clone(),
                        incoming_title: title.clone(),
                        reason: format!("Aynı ISBN ({isbn})"),
                        existing_id: Some(existing.id),
                        existing_title: Some(existing.title),
                    });
                    continue;
                }
            }
        }
        if !hash.is_empty() {
            if let Some(existing) = db::find_by_hash(live, &hash)? {
                if existing.id != id {
                    conflicts.push(BackupConflict {
                        incoming_id: id,
                        incoming_title: title,
                        reason: "Aynı dosya parmak izi".into(),
                        existing_id: Some(existing.id),
                        existing_title: Some(existing.title),
                    });
                }
            }
        }
    }
    Ok(conflicts)
}

pub fn restore_backup(
    state: &DbState,
    path: &str,
    options: RestoreOptions,
) -> Result<RestoreResult, DbError> {
    let preview = inspect_backup(state, path)?;
    if !preview.compatible {
        return Err(err(preview
            .compatibility_message
            .unwrap_or_else(|| "Uyumsuz yedek".into())));
    }
    if !preview.integrity_ok {
        return Err(err(format!(
            "Yedek bütünlük kontrolü başarısız: {}",
            preview.integrity_errors.join("; ")
        )));
    }

    match options.mode.as_str() {
        "replace" => restore_replace(state, path),
        "merge" => restore_merge(state, path, &preview, &options),
        other => Err(err(format!("Bilinmeyen geri yükleme modu: {other}"))),
    }
}

fn restore_replace(state: &DbState, path: &str) -> Result<RestoreResult, DbError> {
    let staging = state
        .data_dir
        .join(format!(".restore-staging-{}", UuidLite::new()));
    let old = state
        .data_dir
        .join(format!(".restore-old-{}", UuidLite::new()));
    fs::create_dir_all(&staging)?;

    let result = (|| {
        unzip_to(Path::new(path), &staging)?;
        let manifest = read_manifest(&staging)?;
        let (ok, errors) = verify_integrity(&staging, &manifest);
        if !ok {
            return Err(err(format!(
                "Geri yükleme iptal: bütünlük hatası — {}",
                errors.join("; ")
            )));
        }

        // Close live DB by replacing with a temp in-memory then reopen after swap
        {
            let mut conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
            // Force checkpoint/close
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            *conn = Connection::open_in_memory().map_err(DbError::from)?;
        }

        // Move current library aside atomically-ish
        if old.exists() {
            let _ = fs::remove_dir_all(&old);
        }
        fs::create_dir_all(&old)?;

        let db_live = state.data_dir.join("varak.db");
        if db_live.exists() {
            fs::rename(&db_live, old.join("varak.db"))?;
        }
        for name in ["varak.db-wal", "varak.db-shm"] {
            let p = state.data_dir.join(name);
            if p.exists() {
                let _ = fs::rename(&p, old.join(name));
            }
        }

        let settings_before = {
            // Read library folder from staged db
            let staged_db = staging.join("data/varak.db");
            let sconn = Connection::open(&staged_db)?;
            db::ensure_defaults(&sconn, &state.data_dir)?;
            db::get_settings(&sconn, &state.data_dir)?
        };
        let library = PathBuf::from(&settings_before.library_folder);
        if library.exists() {
            let lib_old = old.join("library-snapshot");
            // Copy rather than rename in case library is outside data_dir
            copy_dir_recursive(&library, &lib_old)?;
        }

        // Install DB
        let staged_db = staging.join("data/varak.db");
        fs::copy(&staged_db, &db_live)?;

        // Install files into library folder
        fs::create_dir_all(&library)?;
        fs::create_dir_all(library.join("covers"))?;
        copy_zip_subdir(&staging.join("files"), &library)?;
        copy_zip_subdir(&staging.join("covers"), &library.join("covers"))?;

        // Reopen connection
        {
            let mut conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
            *conn = db::open_db(&state.data_dir)?;
            db::ensure_defaults(&conn, &state.data_dir)?;
            // Keep library_folder pointing at current library
            db::update_settings(
                &conn,
                Some(library.to_string_lossy().to_string()),
                None,
            )?;
        }

        let book_count = {
            let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
            db::list_books(
                &conn,
                crate::models::BookFilter {
                    query: None,
                    status: None,
                    tag: None,
                },
            )?
            .len()
        };

        // Cleanup old snapshot on success
        let _ = fs::remove_dir_all(&old);

        Ok(RestoreResult {
            mode: "replace".into(),
            imported_books: book_count,
            skipped: 0,
            replaced: book_count,
            message: format!("Kitaplık yedekten değiştirildi ({book_count} kitap)."),
        })
    })();

    let _ = fs::remove_dir_all(&staging);
    if result.is_err() {
        // Best-effort rollback of DB if we moved it
        let backup_db = old.join("varak.db");
        if backup_db.exists() {
            let live = state.data_dir.join("varak.db");
            let _ = fs::copy(&backup_db, &live);
            if let Ok(mut conn) = state.conn.lock() {
                if let Ok(c) = db::open_db(&state.data_dir) {
                    *conn = c;
                }
            }
        }
    }
    result
}

fn restore_merge(
    state: &DbState,
    path: &str,
    preview: &BackupPreview,
    options: &RestoreOptions,
) -> Result<RestoreResult, DbError> {
    let staging = state
        .data_dir
        .join(format!(".merge-staging-{}", UuidLite::new()));
    fs::create_dir_all(&staging)?;
    let result = (|| {
        unzip_to(Path::new(path), &staging)?;
        let staged_db = staging.join("data/varak.db");
        let bconn = Connection::open(&staged_db)?;

        let resolutions = options
            .conflict_resolutions
            .clone()
            .unwrap_or_default();

        let mut imported = 0usize;
        let mut skipped = 0usize;
        let mut replaced = 0usize;

        let mut stmt = bconn.prepare(
            "SELECT id FROM books ORDER BY updated_at ASC",
        )?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let settings = {
            let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
            db::get_settings(&conn, &state.data_dir)?
        };
        let library = PathBuf::from(&settings.library_folder);
        fs::create_dir_all(&library)?;
        fs::create_dir_all(library.join("covers"))?;

        for id in ids {
            let conflict = preview.conflicts.iter().find(|c| c.incoming_id == id);
            let action = if let Some(c) = conflict {
                resolutions
                    .get(&c.incoming_id)
                    .cloned()
                    .unwrap_or_else(|| "skip".into())
            } else {
                "take_incoming".into()
            };

            match action.as_str() {
                "skip" | "keep_local" => {
                    skipped += 1;
                    continue;
                }
                "take_incoming" => {
                    let was_replace = conflict.is_some();
                    merge_one_book(state, &bconn, &staging, &library, &id)?;
                    if was_replace {
                        replaced += 1;
                    } else {
                        imported += 1;
                    }
                }
                other => {
                    return Err(err(format!(
                        "Bilinmeyen çakışma çözümü '{other}' (kitap {id})"
                    )));
                }
            }
        }

        Ok(RestoreResult {
            mode: "merge".into(),
            imported_books: imported,
            skipped,
            replaced,
            message: format!(
                "Birleştirme tamam: {imported} eklendi, {replaced} değiştirildi, {skipped} atlandı."
            ),
        })
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn merge_one_book(
    state: &DbState,
    bconn: &Connection,
    staging: &Path,
    library: &Path,
    id: &str,
) -> Result<(), DbError> {
    // Read incoming book row raw
    let mut stmt = bconn.prepare(
        "SELECT id, title, author, isbn, status, rating, review, progress, cover_path,
                file_path, file_type, file_hash, page_count, current_page, started_at, finished_at,
                created_at, updated_at FROM books WHERE id=?1",
    )?;
    let row = stmt.query_row(rusqlite::params![id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<i32>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, f64>(7)?,
            r.get::<_, Option<String>>(8)?,
            r.get::<_, Option<String>>(9)?,
            r.get::<_, String>(10)?,
            r.get::<_, Option<String>>(11)?,
            r.get::<_, Option<i32>>(12)?,
            r.get::<_, Option<i32>>(13)?,
            r.get::<_, Option<String>>(14)?,
            r.get::<_, Option<String>>(15)?,
            r.get::<_, String>(16)?,
            r.get::<_, String>(17)?,
        ))
    })?;

    let (
        id,
        title,
        author,
        isbn,
        status,
        rating,
        review,
        progress,
        cover_path,
        file_path,
        file_type,
        file_hash,
        page_count,
        current_page,
        started_at,
        finished_at,
        created_at,
        updated_at,
    ) = row;

    // Copy files if present in staging
    let mut new_file_path = None;
    if let Some(fp) = &file_path {
        let name = Path::new(fp)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{id}.bin"));
        let staged = staging.join("files").join(&name);
        if staged.exists() {
            let dest = library.join(&name);
            fs::copy(&staged, &dest)?;
            new_file_path = Some(dest.to_string_lossy().to_string());
        }
    }
    let mut new_cover_path = None;
    if let Some(cp) = &cover_path {
        let name = Path::new(cp)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{id}.jpg"));
        let staged = staging.join("covers").join(&name);
        if staged.exists() {
            let dest = library.join("covers").join(&name);
            fs::create_dir_all(library.join("covers"))?;
            fs::copy(&staged, &dest)?;
            new_cover_path = Some(dest.to_string_lossy().to_string());
        }
    }

    let mut tstmt = bconn.prepare(
        "SELECT t.name FROM tags t JOIN book_tags bt ON bt.tag_id=t.id WHERE bt.book_id=?1",
    )?;
    let tags: Vec<String> = tstmt
        .query_map(rusqlite::params![id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(tstmt);

    {
        let conn = state.conn.lock().map_err(|e| err(e.to_string()))?;
        if db::get_book(&conn, &id)?.is_some() {
            conn.execute("DELETE FROM books WHERE id=?1", rusqlite::params![id])?;
        }
        conn.execute(
            "INSERT INTO books (id, title, author, isbn, status, rating, review, progress,
                cover_path, file_path, file_type, file_hash, page_count, current_page,
                started_at, finished_at, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
            rusqlite::params![
                id,
                title,
                author,
                isbn,
                status,
                rating,
                review,
                progress,
                new_cover_path.or(cover_path),
                new_file_path.or(file_path),
                file_type,
                file_hash,
                page_count,
                current_page,
                started_at,
                finished_at,
                created_at,
                updated_at
            ],
        )?;
        // tags
        for tag in &tags {
            conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", rusqlite::params![tag])?;
            let tag_id: i64 = conn.query_row(
                "SELECT id FROM tags WHERE name=?1",
                rusqlite::params![tag],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1,?2)",
                rusqlite::params![id, tag_id],
            )?;
        }

        // annotations
        let mut astmt = bconn.prepare(
            "SELECT id, book_id, kind, content, color, location_json, created_at FROM annotations WHERE book_id=?1",
        )?;
        let anns: Vec<_> = astmt
            .query_map(rusqlite::params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (aid, bid, kind, content, color, loc, created) in anns {
            conn.execute("DELETE FROM annotations WHERE id=?1", rusqlite::params![aid])?;
            conn.execute(
                "INSERT INTO annotations (id, book_id, kind, content, color, location_json, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![aid, bid, kind, content, color, loc, created],
            )?;
        }

        // positions
        let pos = bconn
            .query_row(
                "SELECT position_json, updated_at FROM reading_positions WHERE book_id=?1",
                rusqlite::params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .ok();
        if let Some((pj, updated)) = pos {
            conn.execute(
                "INSERT INTO reading_positions (book_id, position_json, updated_at) VALUES (?1,?2,?3)
                 ON CONFLICT(book_id) DO UPDATE SET position_json=excluded.position_json, updated_at=excluded.updated_at",
                rusqlite::params![id, pj, updated],
            )?;
        }
    }
    Ok(())
}

fn unzip_to(zip_path: &Path, dest: &Path) -> Result<(), DbError> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| err(e.to_string()))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| err(e.to_string()))?;
        let outpath = match file.enclosed_name() {
            Some(p) => dest.join(p),
            None => continue,
        };
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut outfile = File::create(&outpath)?;
        std::io::copy(&mut file, &mut outfile)?;
    }
    Ok(())
}

fn copy_zip_subdir(src: &Path, dest: &Path) -> Result<(), DbError> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().unwrap();
            fs::copy(&path, dest.join(name))?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), DbError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// Tiny uuid without pulling another dep into this module path — use crate uuid
struct UuidLite;
impl UuidLite {
    fn new() -> String {
        uuid::Uuid::new_v4().to_string()
    }
}

#[allow(dead_code)]
fn _hash_bytes(b: &[u8]) -> String {
    sha256_bytes(b)
}

#[allow(dead_code)]
pub fn list_books_in_backup_db(path: &Path) -> Result<Vec<Book>, DbError> {
    let conn = Connection::open(path)?;
    db::list_books(
        &conn,
        crate::models::BookFilter {
            query: None,
            status: None,
            tag: None,
        },
    )
}

// silence unused Mutex import warning if any
#[allow(dead_code)]
fn _mutex_ty(_: &Mutex<()>) {}

#[cfg(test)]
mod backup_tests {
    use super::*;
    use crate::db::{self, ensure_defaults, open_db};

    #[test]
    fn create_and_inspect_backup_smoke() {
        let dir = std::env::temp_dir().join(format!("varak-bak-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let conn = open_db(&dir).unwrap();
        ensure_defaults(&conn, &dir).unwrap();
        db::update_settings(&conn, Some(dir.join("library").to_string_lossy().to_string()), None).unwrap();
        let state = db::DbState {
            conn: std::sync::Mutex::new(conn),
            data_dir: dir.clone(),
        };
        let dest = dir.join("out.varakbak");
        let manifest = create_backup(&state, dest.to_str().unwrap()).unwrap();
        assert_eq!(manifest.format, BACKUP_FORMAT);
        assert!(dest.exists());
        let preview = inspect_backup(&state, dest.to_str().unwrap()).unwrap();
        assert!(preview.compatible);
        assert!(preview.integrity_ok);
    }
}
