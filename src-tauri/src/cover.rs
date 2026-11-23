use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub fn epub_has_cover_hint(opf: &str) -> bool {
    let lower = opf.to_lowercase();
    lower.contains("name=\"cover\"")
        || lower.contains("name='cover'")
        || lower.contains("properties=\"cover-image\"")
        || lower.contains("properties='cover-image'")
        || (lower.contains("cover") && lower.contains("media-type=\"image/"))
}

/// Extract an EPUB cover image into `covers_dir/{book_id}.{ext}`.
/// Returns the written path when a cover is found.
pub fn extract_epub_cover(
    epub_path: &Path,
    covers_dir: &Path,
    book_id: &str,
) -> Option<PathBuf> {
    let file = std::fs::File::open(epub_path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;

    let opf_path = find_opf_path(&mut archive)?;
    let opf = read_zip_string(&mut archive, &opf_path)?;
    let opf_dir = parent_zip_dir(&opf_path);

    let cover_href = find_cover_href(&opf)?;
    let cover_zip_path = join_zip_path(&opf_dir, &cover_href);
    let bytes = read_zip_bytes(&mut archive, &cover_zip_path)
        .or_else(|| read_zip_bytes(&mut archive, &cover_href))?;

    let ext = extension_from_name(&cover_zip_path)
        .or_else(|| extension_from_name(&cover_href))
        .unwrap_or_else(|| guess_ext(&bytes).to_string());

    std::fs::create_dir_all(covers_dir).ok()?;
    let dest = covers_dir.join(format!("{book_id}.{ext}"));
    let mut out = std::fs::File::create(&dest).ok()?;
    out.write_all(&bytes).ok()?;
    Some(dest)
}

fn find_opf_path<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Option<String> {
    let container = read_zip_string(archive, "META-INF/container.xml")?;
    // full-path="..."
    let key = "full-path=\"";
    let start = container.find(key)? + key.len();
    let end = container[start..].find('"')? + start;
    Some(container[start..end].to_string())
}

fn find_cover_href(opf: &str) -> Option<String> {
    // <meta name="cover" content="cover-id"/>
    if let Some(content_id) = meta_cover_id(opf) {
        if let Some(href) = manifest_href_by_id(opf, &content_id) {
            return Some(href);
        }
    }
    // properties="cover-image"
    if let Some(href) = manifest_href_with_attr(opf, "properties=\"cover-image\"") {
        return Some(href);
    }
    if let Some(href) = manifest_href_with_attr(opf, "properties='cover-image'") {
        return Some(href);
    }
    // Heuristic: first image item whose id/href contains "cover"
    manifest_coverish_href(opf)
}

fn meta_cover_id(opf: &str) -> Option<String> {
    for needle in [
        "name=\"cover\"",
        "name='cover'",
        "name=\"Cover\"",
    ] {
        if let Some(idx) = opf.find(needle) {
            let window = &opf[idx.saturating_sub(80)..(idx + 120).min(opf.len())];
            if let Some(c) = attr_value(window, "content") {
                return Some(c);
            }
        }
    }
    None
}

fn manifest_href_by_id(opf: &str, id: &str) -> Option<String> {
    let patterns = [format!("id=\"{id}\""), format!("id='{id}'")];
    for pat in patterns {
        if let Some(idx) = opf.find(&pat) {
            let start = idx.saturating_sub(20);
            let end = (idx + 280).min(opf.len());
            let window = &opf[start..end];
            if let Some(href) = attr_value(window, "href") {
                return Some(href);
            }
        }
    }
    None
}

fn manifest_href_with_attr(opf: &str, marker: &str) -> Option<String> {
    let idx = opf.find(marker)?;
    let start = idx.saturating_sub(40);
    let end = (idx + 260).min(opf.len());
    attr_value(&opf[start..end], "href")
}

fn manifest_coverish_href(opf: &str) -> Option<String> {
    let lower = opf.to_lowercase();
    for (i, _) in lower.match_indices("<item") {
        let end = lower[i..].find("/>").or_else(|| lower[i..].find('>'))? + i;
        let chunk = &opf[i..end];
        let chunk_l = chunk.to_lowercase();
        let is_image = chunk_l.contains("media-type=\"image/")
            || chunk_l.contains("media-type='image/")
            || chunk_l.contains(".jpg")
            || chunk_l.contains(".jpeg")
            || chunk_l.contains(".png")
            || chunk_l.contains(".webp")
            || chunk_l.contains(".gif");
        let looks_cover = chunk_l.contains("cover");
        if is_image && looks_cover {
            if let Some(href) = attr_value(chunk, "href") {
                return Some(href);
            }
        }
    }
    None
}

fn attr_value(chunk: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let key = format!("{name}={quote}");
        if let Some(idx) = chunk.find(&key) {
            let start = idx + key.len();
            let rest = &chunk[start..];
            let end = rest.find(quote)?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn parent_zip_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn join_zip_path(dir: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    if href.starts_with('/') {
        return href.trim_start_matches('/').to_string();
    }
    if dir.is_empty() {
        return href.to_string();
    }
    // Resolve simple ../ segments
    let mut parts: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in href.split('/') {
        if seg == ".." {
            parts.pop();
        } else if seg != "." && !seg.is_empty() {
            parts.push(seg);
        }
    }
    parts.join("/")
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

fn read_zip_bytes<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn extension_from_name(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "svg"))
}

fn guess_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "svg"
    } else {
        "jpg"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extracts_cover_from_sample_epub() {
        let epub = PathBuf::from("/tmp/varak-orman.epub");
        if !epub.exists() {
            return;
        }
        let out = PathBuf::from("/tmp/varak-cover-out");
        let _ = std::fs::remove_dir_all(&out);
        let path = extract_epub_cover(&epub, &out, "test-book").expect("cover");
        assert!(path.exists());
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("png"));
        assert!(std::fs::metadata(&path).unwrap().len() > 20);
    }
}
