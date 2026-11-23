use crate::hashutil::sha256_file;
use crate::models::{
    Annotation, AnnotationInput, AppSettings, Book, BookFilter, BookInput, BookUpdate,
    ConfirmImport, DuplicateMatch, FileType, ImportPreview, LibraryStats, PeriodStat,
    ReadingPosition,
};
use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Message(value.to_string())
    }
}

impl From<std::io::Error> for DbError {
    fn from(value: std::io::Error) -> Self {
        Self::Message(value.to_string())
    }
}

pub fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("varak")
}

pub fn default_library_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("library")
}

pub fn open_db(data_dir: &Path) -> Result<Connection, DbError> {
    fs::create_dir_all(data_dir)?;
    fs::create_dir_all(default_library_dir(data_dir))?;
    let db_path = data_dir.join("varak.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            isbn TEXT,
            status TEXT NOT NULL DEFAULT 'okunacak',
            rating INTEGER,
            review TEXT,
            progress REAL NOT NULL DEFAULT 0,
            cover_path TEXT,
            file_path TEXT,
            file_type TEXT NOT NULL DEFAULT 'physical',
            page_count INTEGER,
            current_page INTEGER,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS book_tags (
            book_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (book_id, tag_id),
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            content TEXT,
            color TEXT,
            location_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reading_positions (
            book_id TEXT PRIMARY KEY NOT NULL,
            position_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );
        ",
    )?;
    // Soft migrations for existing DBs
    let _ = conn.execute("ALTER TABLE books ADD COLUMN file_hash TEXT", []);
    Ok(conn)
}

pub fn ensure_defaults(conn: &Connection, data_dir: &Path) -> Result<(), DbError> {
    let library = default_library_dir(data_dir)
        .to_string_lossy()
        .to_string();
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('library_folder', ?1)",
        params![library],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system')",
        [],
    )?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let value = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value)
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_settings(conn: &Connection, data_dir: &Path) -> Result<AppSettings, DbError> {
    let library_folder = get_setting(conn, "library_folder")?.unwrap_or_else(|| {
        default_library_dir(data_dir)
            .to_string_lossy()
            .to_string()
    });
    let theme = get_setting(conn, "theme")?.unwrap_or_else(|| "system".into());
    Ok(AppSettings {
        library_folder,
        theme,
    })
}

pub fn update_settings(
    conn: &Connection,
    library_folder: Option<String>,
    theme: Option<String>,
) -> Result<AppSettings, DbError> {
    if let Some(folder) = &library_folder {
        fs::create_dir_all(folder)?;
        set_setting(conn, "library_folder", folder)?;
    }
    if let Some(theme) = &theme {
        set_setting(conn, "theme", theme)?;
    }
    let data_dir = default_data_dir();
    get_settings(conn, &data_dir)
}

fn book_tags(conn: &Connection, book_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t
         JOIN book_tags bt ON bt.tag_id = t.id
         WHERE bt.book_id = ?1
         ORDER BY t.name COLLATE NOCASE",
    )?;
    let tags = stmt
        .query_map(params![book_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

fn replace_tags(conn: &Connection, book_id: &str, tags: &[String]) -> Result<(), DbError> {
    conn.execute("DELETE FROM book_tags WHERE book_id = ?1", params![book_id])?;
    for tag in tags {
        let name = tag.trim();
        if name.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
            params![name],
        )?;
        let tag_id: i64 = conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
            params![book_id, tag_id],
        )?;
    }
    Ok(())
}

fn map_book(conn: &Connection, row: &rusqlite::Row<'_>) -> Result<Book, rusqlite::Error> {
    let id: String = row.get(0)?;
    let tags = book_tags(conn, &id).unwrap_or_default();
    Ok(Book {
        id,
        title: row.get(1)?,
        author: row.get(2)?,
        isbn: row.get(3)?,
        status: row.get(4)?,
        rating: row.get(5)?,
        review: row.get(6)?,
        progress: row.get(7)?,
        cover_path: row.get(8)?,
        file_path: row.get(9)?,
        file_type: row.get(10)?,
        file_hash: row.get(11)?,
        page_count: row.get(12)?,
        current_page: row.get(13)?,
        started_at: row.get(14)?,
        finished_at: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        tags,
    })
}

const BOOK_COLS: &str = "b.id, b.title, b.author, b.isbn, b.status, b.rating, b.review,
                b.progress, b.cover_path, b.file_path, b.file_type, b.file_hash, b.page_count,
                b.current_page, b.started_at, b.finished_at, b.created_at, b.updated_at";

pub fn list_books(conn: &Connection, filter: BookFilter) -> Result<Vec<Book>, DbError> {
    let mut sql = format!(
        "SELECT DISTINCT {BOOK_COLS}
         FROM books b
         LEFT JOIN book_tags bt ON bt.book_id = b.id
         LEFT JOIN tags t ON t.id = bt.tag_id
         WHERE 1=1"
    );
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(status) = filter.status.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        sql.push_str(" AND b.status = ?");
        values.push(Box::new(status.clone()));
    }
    if let Some(tag) = filter.tag.as_ref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.name = ?");
        values.push(Box::new(tag.clone()));
    }
    if let Some(query) = filter.query.as_ref().filter(|s| !s.trim().is_empty()) {
        let q = format!("%{}%", query.trim());
        sql.push_str(
            " AND (b.title LIKE ? OR IFNULL(b.author,'') LIKE ? OR IFNULL(b.isbn,'') LIKE ?)",
        );
        values.push(Box::new(q.clone()));
        values.push(Box::new(q.clone()));
        values.push(Box::new(q));
    }
    sql.push_str(" ORDER BY b.updated_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    let books = stmt
        .query_map(params_refs.as_slice(), |row| map_book(conn, row))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(books)
}

pub fn get_book(conn: &Connection, id: &str) -> Result<Option<Book>, DbError> {
    let sql = format!("SELECT {BOOK_COLS} FROM books b WHERE b.id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let book = stmt
        .query_row(params![id], |row| map_book(conn, row))
        .optional()?;
    Ok(book)
}

pub fn find_by_isbn(conn: &Connection, isbn: &str) -> Result<Option<Book>, DbError> {
    let cleaned: String = isbn
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
        .collect::<String>()
        .to_uppercase();
    if cleaned.is_empty() {
        return Ok(None);
    }
    let sql = format!(
        "SELECT {BOOK_COLS} FROM books b
         WHERE REPLACE(REPLACE(UPPER(IFNULL(b.isbn,'')),'-',''),' ','') = ?1
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let book = stmt
        .query_row(params![cleaned], |row| map_book(conn, row))
        .optional()?;
    Ok(book)
}

pub fn find_by_hash(conn: &Connection, hash: &str) -> Result<Option<Book>, DbError> {
    if hash.is_empty() {
        return Ok(None);
    }
    let sql = format!("SELECT {BOOK_COLS} FROM books b WHERE b.file_hash = ?1 LIMIT 1");
    let mut stmt = conn.prepare(&sql)?;
    let book = stmt
        .query_row(params![hash], |row| map_book(conn, row))
        .optional()?;
    Ok(book)
}

pub fn create_book(conn: &Connection, input: BookInput) -> Result<Book, DbError> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let status = input
        .status
        .unwrap_or_else(|| "okunacak".into());
    conn.execute(
        "INSERT INTO books (id, title, author, isbn, status, rating, review, progress,
            cover_path, file_path, file_type, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, NULL, 'physical', ?9, ?9)",
        params![
            id,
            input.title.trim(),
            input.author,
            input.isbn,
            status,
            input.rating,
            input.review,
            input.cover_path,
            ts
        ],
    )?;
    if let Some(tags) = input.tags {
        replace_tags(conn, &id, &tags)?;
    }
    get_book(conn, &id)?.ok_or_else(|| DbError::Message("Kitap oluşturulamadı".into()))
}

pub fn update_book(conn: &Connection, id: &str, input: BookUpdate) -> Result<Book, DbError> {
    let existing = get_book(conn, id)?.ok_or_else(|| DbError::Message("Kitap bulunamadı".into()))?;
    let title = input.title.unwrap_or(existing.title);
    let author = input.author.or(existing.author);
    let isbn = input.isbn.or(existing.isbn);
    let status = input.status.unwrap_or(existing.status);
    let rating = input.rating.or(existing.rating);
    let review = input.review.or(existing.review);
    let progress = input.progress.unwrap_or(existing.progress);
    let current_page = input.current_page.or(existing.current_page);
    let page_count = input.page_count.or(existing.page_count);
    let started_at = input.started_at.or(existing.started_at);
    let finished_at = input.finished_at.or(existing.finished_at);
    let cover_path = input.cover_path.or(existing.cover_path);
    let ts = now();

    conn.execute(
        "UPDATE books SET title=?2, author=?3, isbn=?4, status=?5, rating=?6, review=?7,
            progress=?8, current_page=?9, page_count=?10, started_at=?11, finished_at=?12,
            cover_path=?13, updated_at=?14
         WHERE id=?1",
        params![
            id,
            title.trim(),
            author,
            isbn,
            status,
            rating,
            review,
            progress,
            current_page,
            page_count,
            started_at,
            finished_at,
            cover_path,
            ts
        ],
    )?;
    if let Some(tags) = input.tags {
        replace_tags(conn, id, &tags)?;
    }
    get_book(conn, id)?.ok_or_else(|| DbError::Message("Kitap güncellenemedi".into()))
}

pub fn delete_book(conn: &Connection, id: &str) -> Result<(), DbError> {
    if let Some(book) = get_book(conn, id)? {
        if let Some(path) = book.file_path {
            let _ = fs::remove_file(path);
        }
        if let Some(cover) = book.cover_path {
            if cover.contains("/varak/") || cover.contains("\\varak\\") {
                let _ = fs::remove_file(cover);
            }
        }
    }
    conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
    Ok(())
}

/// Attach a PDF/EPUB file to an existing book (e.g. physical entry → readable).
pub fn attach_book_file(conn: &Connection, book_id: &str, source_path: &str) -> Result<Book, DbError> {
    let existing = get_book(conn, book_id)?.ok_or_else(|| DbError::Message("Kitap bulunamadı".into()))?;
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err(DbError::Message("Dosya bulunamadı".into()));
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let file_type = match ext.as_str() {
        "pdf" => FileType::Pdf,
        "epub" => FileType::Epub,
        _ => {
            return Err(DbError::Message(
                "Yalnızca PDF veya EPUB dosyası bağlanabilir".into(),
            ))
        }
    };
    let meta = fs::metadata(&source)?;
    if meta.len() == 0 {
        return Err(DbError::Message(
            "Seçilen dosya boş (0 bayt). Geçerli bir PDF/EPUB seçin.".into(),
        ));
    }
    let file_hash = sha256_file(&source).map_err(DbError::Message)?;

    let settings = get_settings(conn, &default_data_dir())?;
    let library = PathBuf::from(&settings.library_folder);
    fs::create_dir_all(&library)?;

    // Remove previous managed file if present
    if let Some(old) = &existing.file_path {
        let _ = fs::remove_file(old);
    }

    let dest = library.join(format!("{book_id}.{ext}"));
    let copied = fs::copy(&source, &dest)?;
    if copied == 0 {
        let _ = fs::remove_file(&dest);
        return Err(DbError::Message(
            "Dosya kitaplığa kopyalanamadı (0 bayt).".into(),
        ));
    }

    let mut cover_path = existing.cover_path.clone();
    if matches!(file_type, FileType::Epub) && cover_path.is_none() {
        let covers = library.join("covers");
        if let Some(path) = crate::cover::extract_epub_cover(&dest, &covers, book_id) {
            cover_path = Some(path.to_string_lossy().to_string());
        }
    }

    let ts = now();
    conn.execute(
        "UPDATE books SET file_path=?2, file_type=?3, file_hash=?4, cover_path=?5, updated_at=?6
         WHERE id=?1",
        params![
            book_id,
            dest.to_string_lossy().to_string(),
            file_type.as_str(),
            file_hash,
            cover_path,
            ts
        ],
    )?;
    get_book(conn, book_id)?.ok_or_else(|| DbError::Message("Dosya bağlanamadı".into()))
}

pub fn preview_import(conn: &Connection, source_path: &str) -> Result<ImportPreview, DbError> {
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err(DbError::Message("Dosya bulunamadı".into()));
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let file_type = match ext.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        _ => {
            return Err(DbError::Message(
                "Yalnızca PDF veya EPUB dosyaları içe aktarılabilir".into(),
            ))
        }
    };
    let file_size = fs::metadata(&source)?.len();
    if file_size == 0 {
        return Err(DbError::Message(
            "Seçilen dosya boş (0 bayt). Geçerli bir PDF/EPUB seçin.".into(),
        ));
    }
    let file_hash = sha256_file(&source).map_err(DbError::Message)?;

    let mut title = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Adsız kitap")
        .to_string();
    let mut author = None;
    let mut isbn = None;
    let mut has_embedded_cover = false;

    if file_type == "epub" {
        let meta = crate::epub_meta::read_epub_meta(&source);
        if let Some(t) = meta.title.filter(|s| !s.trim().is_empty()) {
            title = t;
        }
        author = meta.author;
        isbn = meta.isbn;
        has_embedded_cover = meta.has_cover;
    }

    let mut duplicates = Vec::new();
    if let Some(ref isbn_v) = isbn {
        if let Some(existing) = find_by_isbn(conn, isbn_v)? {
            duplicates.push(DuplicateMatch {
                book_id: existing.id,
                title: existing.title,
                author: existing.author,
                match_type: "isbn".into(),
            });
        }
    }
    if let Some(existing) = find_by_hash(conn, &file_hash)? {
        if !duplicates.iter().any(|d| d.book_id == existing.id) {
            duplicates.push(DuplicateMatch {
                book_id: existing.id,
                title: existing.title,
                author: existing.author,
                match_type: "file_hash".into(),
            });
        }
    }

    Ok(ImportPreview {
        path: source_path.to_string(),
        title,
        author,
        isbn,
        file_type: file_type.into(),
        file_hash,
        file_size,
        duplicates,
        has_embedded_cover,
    })
}

pub fn confirm_import(conn: &Connection, input: ConfirmImport) -> Result<Book, DbError> {
    let preview = preview_import(conn, &input.path)?;
    if !preview.duplicates.is_empty() && !input.import_despite_duplicates {
        return Err(DbError::Message(
            "Yinelenen kitap tespit edildi. Sessiz birleştirme yapılmaz — onay gerekli.".into(),
        ));
    }

    let source = PathBuf::from(&input.path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let file_type = match ext.as_str() {
        "pdf" => FileType::Pdf,
        "epub" => FileType::Epub,
        _ => {
            return Err(DbError::Message(
                "Yalnızca PDF veya EPUB dosyaları içe aktarılabilir".into(),
            ))
        }
    };

    let settings = get_settings(conn, &default_data_dir())?;
    let library = PathBuf::from(&settings.library_folder);
    fs::create_dir_all(&library)?;

    let id = Uuid::new_v4().to_string();
    let dest_name = format!("{id}.{ext}");
    let dest = library.join(&dest_name);
    let copied = fs::copy(&source, &dest)?;
    if copied == 0 || preview.file_size == 0 {
        let _ = fs::remove_file(&dest);
        return Err(DbError::Message(
            "Seçilen dosya boş veya kopyalanamadı. Geçerli bir PDF/EPUB seçin.".into(),
        ));
    }

    let mut cover_path: Option<String> = None;
    if matches!(file_type, FileType::Epub) {
        let covers = library.join("covers");
        if let Some(path) = crate::cover::extract_epub_cover(&dest, &covers, &id) {
            cover_path = Some(path.to_string_lossy().to_string());
        }
    }

    let title = if input.title.trim().is_empty() {
        preview.title
    } else {
        input.title.trim().to_string()
    };
    let author = input.author.filter(|s| !s.trim().is_empty()).or(preview.author);
    let isbn = input.isbn.filter(|s| !s.trim().is_empty()).or(preview.isbn);

    let ts = now();
    conn.execute(
        "INSERT INTO books (id, title, author, isbn, status, rating, review, progress,
            cover_path, file_path, file_type, file_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'okunacak', NULL, NULL, 0, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            title,
            author,
            isbn,
            cover_path,
            dest.to_string_lossy().to_string(),
            file_type.as_str(),
            preview.file_hash,
            ts
        ],
    )?;
    get_book(conn, &id)?.ok_or_else(|| DbError::Message("İçe aktarma başarısız".into()))
}

/// Legacy helper used by tests — wraps confirm without duplicate override when clean.
pub fn import_file(
    conn: &Connection,
    source_path: &str,
    title: Option<String>,
    author: Option<String>,
) -> Result<Book, DbError> {
    let preview = preview_import(conn, source_path)?;
    confirm_import(
        conn,
        ConfirmImport {
            path: source_path.to_string(),
            title: title.unwrap_or(preview.title),
            author: author.or(preview.author),
            isbn: preview.isbn,
            import_despite_duplicates: preview.duplicates.is_empty(),
        },
    )
}

pub fn get_statistics(conn: &Connection) -> Result<LibraryStats, DbError> {
    let books = list_books(
        conn,
        BookFilter {
            query: None,
            status: None,
            tag: None,
        },
    )?;
    let total_books = books.len();
    let read_books = books.iter().filter(|b| b.status == "okudum").count();
    let reading_books = books.iter().filter(|b| b.status == "okuyorum").count();
    let to_read_books = books.iter().filter(|b| b.status == "okunacak").count();
    let abandoned_books = books
        .iter()
        .filter(|b| b.status == "yarim_biraktim")
        .count();

    let mut pages_read: i64 = 0;
    for b in &books {
        if let (Some(cur), Some(total)) = (b.current_page, b.page_count) {
            pages_read += i64::from(cur.min(total));
        } else if b.status == "okudum" {
            if let Some(total) = b.page_count {
                pages_read += i64::from(total);
            }
        } else if b.progress > 0.0 {
            if let Some(total) = b.page_count {
                pages_read += ((b.progress / 100.0) * f64::from(total)).round() as i64;
            }
        }
    }

    let annotations: i64 =
        conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))?;
    let highlights: i64 = conn.query_row(
        "SELECT COUNT(*) FROM annotations WHERE kind='highlight'",
        [],
        |r| r.get(0),
    )?;
    let notes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM annotations WHERE kind='note'",
        [],
        |r| r.get(0),
    )?;
    let bookmarks: i64 = conn.query_row(
        "SELECT COUNT(*) FROM annotations WHERE kind='bookmark'",
        [],
        |r| r.get(0),
    )?;

    let mut monthly_map: HashMap<String, (usize, i64)> = HashMap::new();
    let mut yearly_map: HashMap<String, (usize, i64)> = HashMap::new();
    for b in &books {
        let Some(finished) = b.finished_at.as_ref() else {
            continue;
        };
        let date = NaiveDate::parse_from_str(&finished.chars().take(10).collect::<String>(), "%Y-%m-%d")
            .ok()
            .or_else(|| {
                finished
                    .get(..10)
                    .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            });
        let Some(date) = date else { continue };
        if b.status != "okudum" && b.progress < 99.0 {
            continue;
        }
        let month = format!("{:04}-{:02}", date.year(), date.month());
        let year = format!("{:04}", date.year());
        let pages = b.page_count.map(i64::from).unwrap_or(0);
        let e = monthly_map.entry(month).or_insert((0, 0));
        e.0 += 1;
        e.1 += pages;
        let e = yearly_map.entry(year).or_insert((0, 0));
        e.0 += 1;
        e.1 += pages;
    }

    let mut monthly: Vec<PeriodStat> = monthly_map
        .into_iter()
        .map(|(period, (books_finished, pages_read))| PeriodStat {
            period,
            books_finished,
            pages_read,
        })
        .collect();
    monthly.sort_by(|a, b| b.period.cmp(&a.period));
    monthly.truncate(24);

    let mut yearly: Vec<PeriodStat> = yearly_map
        .into_iter()
        .map(|(period, (books_finished, pages_read))| PeriodStat {
            period,
            books_finished,
            pages_read,
        })
        .collect();
    yearly.sort_by(|a, b| b.period.cmp(&a.period));

    Ok(LibraryStats {
        total_books,
        read_books,
        reading_books,
        to_read_books,
        abandoned_books,
        pages_read,
        annotations: annotations as usize,
        highlights: highlights as usize,
        notes: notes as usize,
        bookmarks: bookmarks as usize,
        monthly,
        yearly,
    })
}

pub fn list_tags(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE")?;
    let tags = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

pub fn list_annotations(conn: &Connection, book_id: &str) -> Result<Vec<Annotation>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, book_id, kind, content, color, location_json, created_at
         FROM annotations WHERE book_id = ?1 ORDER BY created_at DESC",
    )?;
    let items = stmt
        .query_map(params![book_id], |row| {
            Ok(Annotation {
                id: row.get(0)?,
                book_id: row.get(1)?,
                kind: row.get(2)?,
                content: row.get(3)?,
                color: row.get(4)?,
                location_json: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn add_annotation(conn: &Connection, input: AnnotationInput) -> Result<Annotation, DbError> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    conn.execute(
        "INSERT INTO annotations (id, book_id, kind, content, color, location_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            input.book_id,
            input.kind,
            input.content,
            input.color,
            input.location_json,
            ts
        ],
    )?;
    Ok(Annotation {
        id,
        book_id: input.book_id,
        kind: input.kind,
        content: input.content,
        color: input.color,
        location_json: input.location_json,
        created_at: ts,
    })
}

pub fn delete_annotation(conn: &Connection, id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM annotations WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_position(conn: &Connection, book_id: &str) -> Result<Option<ReadingPosition>, DbError> {
    let pos = conn
        .query_row(
            "SELECT book_id, position_json, updated_at FROM reading_positions WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok(ReadingPosition {
                    book_id: row.get(0)?,
                    position_json: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(pos)
}

pub fn save_position(
    conn: &Connection,
    book_id: &str,
    position_json: &str,
) -> Result<ReadingPosition, DbError> {
    let ts = now();
    conn.execute(
        "INSERT INTO reading_positions (book_id, position_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id) DO UPDATE SET position_json = excluded.position_json,
            updated_at = excluded.updated_at",
        params![book_id, position_json, ts],
    )?;
    Ok(ReadingPosition {
        book_id: book_id.to_string(),
        position_json: position_json.to_string(),
        updated_at: ts,
    })
}

pub fn extract_cover_from_epub(conn: &Connection, book_id: &str) -> Result<Book, DbError> {
    let book = get_book(conn, book_id)?.ok_or_else(|| DbError::Message("Kitap bulunamadı".into()))?;
    if book.file_type != "epub" {
        return Err(DbError::Message("Kapak çıkarma yalnızca EPUB için".into()));
    }
    let file_path = book
        .file_path
        .ok_or_else(|| DbError::Message("EPUB dosya yolu yok".into()))?;
    let settings = get_settings(conn, &default_data_dir())?;
    let covers = PathBuf::from(&settings.library_folder).join("covers");
    let path = crate::cover::extract_epub_cover(Path::new(&file_path), &covers, book_id)
        .ok_or_else(|| DbError::Message("EPUB içinde kapak bulunamadı".into()))?;
    update_book(
        conn,
        book_id,
        BookUpdate {
            cover_path: Some(path.to_string_lossy().to_string()),
            title: None,
            author: None,
            isbn: None,
            status: None,
            rating: None,
            review: None,
            progress: None,
            current_page: None,
            page_count: None,
            started_at: None,
            finished_at: None,
            tags: None,
        },
    )
}

pub fn save_cover_bytes(
    conn: &Connection,
    book_id: &str,
    bytes: &[u8],
    ext: &str,
) -> Result<Book, DbError> {
    let settings = get_settings(conn, &default_data_dir())?;
    let covers = PathBuf::from(&settings.library_folder).join("covers");
    fs::create_dir_all(&covers)?;
    let path = covers.join(format!("{book_id}.{ext}"));
    fs::write(&path, bytes)?;
    update_book(
        conn,
        book_id,
        BookUpdate {
            cover_path: Some(path.to_string_lossy().to_string()),
            title: None,
            author: None,
            isbn: None,
            status: None,
            rating: None,
            review: None,
            progress: None,
            current_page: None,
            page_count: None,
            started_at: None,
            finished_at: None,
            tags: None,
        },
    )
}

#[cfg(test)]
mod import_tests {
    use super::*;

    #[test]
    fn import_epub_writes_cover() {
        let epub = "/tmp/varak-orman.epub";
        if !std::path::Path::new(epub).exists() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("varak-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let conn = open_db(&dir).unwrap();
        ensure_defaults(&conn, &dir).unwrap();
        // Point library folder into temp dir
        update_settings(&conn, Some(dir.join("library").to_string_lossy().to_string()), None).unwrap();
        let book = import_file(&conn, epub, Some("Kapak Testi".into()), Some("Test".into())).unwrap();
        assert_eq!(book.file_type, "epub");
        let cover = book.cover_path.expect("cover_path");
        assert!(std::path::Path::new(&cover).exists(), "{cover}");
    }

    #[test]
    fn attach_copies_nonempty_pdf_into_library() {
        let src = std::env::temp_dir().join(format!("varak-attach-src-{}.pdf", std::process::id()));
        let payload = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
        std::fs::write(&src, payload).unwrap();

        let dir = std::env::temp_dir().join(format!("varak-attach-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let conn = open_db(&dir).unwrap();
        ensure_defaults(&conn, &dir).unwrap();
        let library = dir.join("library");
        update_settings(
            &conn,
            Some(library.to_string_lossy().to_string()),
            None,
        )
        .unwrap();

        let physical = create_book(
            &conn,
            BookInput {
                title: "Fiziksel sonra PDF".into(),
                author: Some("Test".into()),
                isbn: None,
                status: Some("okunacak".into()),
                rating: None,
                review: None,
                tags: None,
                cover_path: None,
            },
        )
        .unwrap();
        assert_eq!(physical.file_type, "physical");

        let attached = attach_book_file(&conn, &physical.id, src.to_str().unwrap()).unwrap();
        assert_eq!(attached.file_type, "pdf");
        let path = attached.file_path.expect("file_path");
        assert!(path.starts_with(library.to_string_lossy().as_ref()));
        let meta = std::fs::metadata(&path).unwrap();
        assert_eq!(meta.len() as usize, payload.len());
        assert_ne!(path, src.to_string_lossy());

        let empty = std::env::temp_dir().join(format!("varak-empty-{}.pdf", std::process::id()));
        std::fs::write(&empty, b"").unwrap();
        let err = attach_book_file(&conn, &physical.id, empty.to_str().unwrap()).unwrap_err();
        assert!(format!("{err}").contains("boş") || format!("{err}").contains("0"));
    }
}
