use crate::models::MetadataResult;
use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum MetaError {
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for MetaError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct OlSearch {
    docs: Option<Vec<OlDoc>>,
}

#[derive(Debug, Deserialize)]
struct OlDoc {
    title: Option<String>,
    author_name: Option<Vec<String>>,
    isbn: Option<Vec<String>>,
    cover_i: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct GbResponse {
    items: Option<Vec<GbItem>>,
}

#[derive(Debug, Deserialize)]
struct GbItem {
    volume_info: Option<GbVolume>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GbVolume {
    title: Option<String>,
    authors: Option<Vec<String>>,
    industry_identifiers: Option<Vec<GbId>>,
    image_links: Option<GbImages>,
}

#[derive(Debug, Deserialize)]
struct GbId {
    #[serde(rename = "type")]
    id_type: Option<String>,
    identifier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GbImages {
    thumbnail: Option<String>,
    small_thumbnail: Option<String>,
}

pub async fn search_metadata(
    query: String,
    isbn: Option<String>,
) -> Result<Vec<MetadataResult>, MetaError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| MetaError::Message(e.to_string()))?;

    let mut results = Vec::new();

    if let Some(isbn) = isbn.as_ref().filter(|s| !s.trim().is_empty()) {
        let cleaned: String = isbn.chars().filter(|c| c.is_ascii_digit() || *c == 'X').collect();
        if let Ok(more) = search_open_library(&client, None, Some(&cleaned)).await {
            results.extend(more);
        }
        if let Ok(more) = search_google_books(&client, None, Some(&cleaned)).await {
            results.extend(more);
        }
    }

    let q = query.trim();
    if !q.is_empty() {
        if let Ok(more) = search_open_library(&client, Some(q), None).await {
            results.extend(more);
        }
        if let Ok(more) = search_google_books(&client, Some(q), None).await {
            results.extend(more);
        }
    }

    // Deduplicate by title+author loosely
    let mut seen = std::collections::HashSet::new();
    results.retain(|r| {
        let key = format!(
            "{}|{}",
            r.title.clone().unwrap_or_default().to_lowercase(),
            r.author.clone().unwrap_or_default().to_lowercase()
        );
        seen.insert(key)
    });

    Ok(results.into_iter().take(12).collect())
}

async fn search_open_library(
    client: &reqwest::Client,
    query: Option<&str>,
    isbn: Option<&str>,
) -> Result<Vec<MetadataResult>, MetaError> {
    let url = if let Some(isbn) = isbn {
        format!("https://openlibrary.org/search.json?isbn={}&limit=5", urlencoding::encode(isbn))
    } else if let Some(q) = query {
        format!("https://openlibrary.org/search.json?q={}&limit=5", urlencoding::encode(q))
    } else {
        return Ok(vec![]);
    };

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| MetaError::Message(format!("Open Library erişilemedi: {e}")))?;
    if !resp.status().is_success() {
        return Err(MetaError::Message("Open Library yanıt vermedi".into()));
    }
    let body: OlSearch = resp
        .json()
        .await
        .map_err(|e| MetaError::Message(e.to_string()))?;

    Ok(body
        .docs
        .unwrap_or_default()
        .into_iter()
        .map(|d| MetadataResult {
            title: d.title,
            author: d.author_name.and_then(|a| a.into_iter().next()),
            isbn: d.isbn.and_then(|i| i.into_iter().next()),
            cover_url: d
                .cover_i
                .map(|id| format!("https://covers.openlibrary.org/b/id/{id}-M.jpg")),
            source: "Open Library".into(),
        })
        .collect())
}

async fn search_google_books(
    client: &reqwest::Client,
    query: Option<&str>,
    isbn: Option<&str>,
) -> Result<Vec<MetadataResult>, MetaError> {
    let q = if let Some(isbn) = isbn {
        format!("isbn:{}", isbn)
    } else if let Some(q) = query {
        q.to_string()
    } else {
        return Ok(vec![]);
    };
    let url = format!(
        "https://www.googleapis.com/books/v1/volumes?q={}&maxResults=5",
        urlencoding::encode(&q)
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| MetaError::Message(format!("Google Books erişilemedi: {e}")))?;
    if !resp.status().is_success() {
        return Err(MetaError::Message("Google Books yanıt vermedi".into()));
    }
    let body: GbResponse = resp
        .json()
        .await
        .map_err(|e| MetaError::Message(e.to_string()))?;

    Ok(body
        .items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.volume_info)
        .map(|v| {
            let isbn = v.industry_identifiers.and_then(|ids| {
                ids.into_iter()
                    .find(|i| {
                        matches!(
                            i.id_type.as_deref(),
                            Some("ISBN_13") | Some("ISBN_10")
                        )
                    })
                    .and_then(|i| i.identifier)
            });
            let cover = v
                .image_links
                .and_then(|img| img.thumbnail.or(img.small_thumbnail))
                .map(|u| u.replace("http://", "https://"));
            MetadataResult {
                title: v.title,
                author: v.authors.and_then(|a| a.into_iter().next()),
                isbn,
                cover_url: cover,
                source: "Google Books".into(),
            }
        })
        .collect())
}

pub async fn download_cover(url: &str) -> Result<(Vec<u8>, String), MetaError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| MetaError::Message(e.to_string()))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| MetaError::Message(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(MetaError::Message("Kapak indirilemedi".into()));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let ext = if content_type.contains("png") {
        "png"
    } else if content_type.contains("webp") {
        "webp"
    } else {
        "jpg"
    };
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| MetaError::Message(e.to_string()))?
        .to_vec();
    Ok((bytes, ext.into()))
}
