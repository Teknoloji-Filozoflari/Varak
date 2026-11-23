use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Default, Clone)]
pub struct EpubMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub isbn: Option<String>,
    pub has_cover: bool,
}

pub fn read_epub_meta(path: &Path) -> EpubMeta {
    let mut meta = EpubMeta::default();
    let Ok(file) = std::fs::File::open(path) else {
        return meta;
    };
    let Ok(mut archive) = ZipArchive::new(file) else {
        return meta;
    };
    let Some(opf_path) = find_opf_path(&mut archive) else {
        return meta;
    };
    let Some(opf) = read_zip_string(&mut archive, &opf_path) else {
        return meta;
    };
    meta.title = dc_text(&opf, "title");
    meta.author = dc_text(&opf, "creator");
    meta.isbn = find_isbn(&opf);
    meta.has_cover = crate::cover::epub_has_cover_hint(&opf);
    meta
}

fn find_opf_path<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Option<String> {
    let container = read_zip_string(archive, "META-INF/container.xml")?;
    let key = "full-path=\"";
    let start = container.find(key)? + key.len();
    let end = container[start..].find('"')? + start;
    Some(container[start..end].to_string())
}

fn read_zip_string<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    Some(buf)
}

fn dc_text(opf: &str, local: &str) -> Option<String> {
    for pattern in [
        format!("<dc:{local}>"),
        format!("<dc:{local} "),
        format!("<{local}>"),
    ] {
        if let Some(idx) = opf.find(&pattern) {
            let after = &opf[idx..];
            let start = after.find('>')? + 1;
            let end = after[start..].find('<')? + start;
            let text = after[start..end].trim();
            if !text.is_empty() {
                return Some(html_decode(text));
            }
        }
    }
    None
}

fn find_isbn(opf: &str) -> Option<String> {
    // <dc:identifier opf:scheme="ISBN">...</dc:identifier>
    let lower = opf.to_lowercase();
    if let Some(idx) = lower.find("isbn") {
        let window = &opf[idx.saturating_sub(40)..(idx + 80).min(opf.len())];
        let digits: String = window
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x' || *c == '-')
            .collect();
        let cleaned: String = digits.chars().filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x').collect();
        if cleaned.len() == 10 || cleaned.len() == 13 {
            return Some(cleaned.to_uppercase());
        }
    }
    None
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}
