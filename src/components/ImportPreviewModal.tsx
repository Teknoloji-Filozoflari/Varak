import { useState } from "react";
import { api } from "../api";
import type { Book, ImportPreview, MetadataResult } from "../types";

interface Props {
  preview: ImportPreview;
  onCancel: () => void;
  onImported: (book: Book) => void;
}

export function ImportPreviewModal({ preview, onCancel, onImported }: Props) {
  const [title, setTitle] = useState(preview.title);
  const [author, setAuthor] = useState(preview.author || "");
  const [isbn, setIsbn] = useState(preview.isbn || "");
  const [despite, setDespite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState({ title: false, author: false, isbn: false });

  const hasDupes = preview.duplicates.length > 0;

  async function searchMeta() {
    setMetaBusy(true);
    setMetaError(null);
    try {
      const found = await api.searchOnlineMetadata(title || author, isbn || undefined);
      setResults(found);
      if (!found.length) setMetaError("Sonuç yok veya çevrimdışısınız.");
    } catch {
      setMetaError("Çevrimiçi arama başarısız (ağ yok veya servis kapalı). Dosya içeriği gönderilmez.");
      setResults([]);
    } finally {
      setMetaBusy(false);
    }
  }

  function applyMeta(item: MetadataResult) {
    // Never overwrite fields the user already edited
    if (!touched.title && item.title) setTitle(item.title);
    if (!touched.author && item.author) setAuthor(item.author);
    if (!touched.isbn && item.isbn) setIsbn(item.isbn);
  }

  async function submit() {
    if (hasDupes && !despite) {
      setError("Yinelenen kayıt var. Sessiz birleştirme yok — kutuyu işaretleyin veya vazgeçin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const book = await api.confirmImport({
        path: preview.path,
        title,
        author: author || null,
        isbn: isbn || null,
        importDespiteDuplicates: despite,
      });
      onImported(book);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="panel modal-panel">
        <h2>İçe aktarma önizlemesi</h2>
        <p className="muted">
          {preview.fileType.toUpperCase()} · {(preview.fileSize / 1024).toFixed(1)} KB · parmak izi{" "}
          {preview.fileHash.slice(0, 12)}…
          {preview.hasEmbeddedCover ? " · gömülü kapak var" : ""}
        </p>

        <div className="form-grid">
          <label>
            Başlık
            <input
              value={title}
              onChange={(e) => {
                setTouched((t) => ({ ...t, title: true }));
                setTitle(e.target.value);
              }}
            />
          </label>
          <label>
            Yazar
            <input
              value={author}
              onChange={(e) => {
                setTouched((t) => ({ ...t, author: true }));
                setAuthor(e.target.value);
              }}
            />
          </label>
          <label>
            ISBN
            <input
              value={isbn}
              onChange={(e) => {
                setTouched((t) => ({ ...t, isbn: true }));
                setIsbn(e.target.value);
              }}
            />
          </label>

          {hasDupes && (
            <div className="dupe-box">
              <strong>Yinelenen kayıt uyarısı</strong>
              <ul>
                {preview.duplicates.map((d) => (
                  <li key={`${d.bookId}-${d.matchType}`}>
                    {d.title}
                    {d.author ? ` — ${d.author}` : ""} ({d.matchType === "isbn" ? "ISBN" : "dosya izi"})
                  </li>
                ))}
              </ul>
              <label className="row" style={{ gap: "0.45rem" }}>
                <input
                  type="checkbox"
                  checked={despite}
                  onChange={(e) => setDespite(e.target.checked)}
                />
                Yine de ayrı bir kayıt olarak içe aktar (üzerine yazılmaz)
              </label>
            </div>
          )}

          <div className="row">
            <button type="button" className="btn" disabled={metaBusy} onClick={() => void searchMeta()}>
              {metaBusy ? "Aranıyor…" : "Çevrimiçi metadata (ISBN/başlık)"}
            </button>
            <span className="muted">Dosya içeriği asla gönderilmez.</span>
          </div>
          {metaError && <p className="muted">{metaError}</p>}
          {!!results.length && (
            <div className="meta-results">
              {results.map((item, i) => (
                <button
                  key={`${item.source}-${i}`}
                  type="button"
                  className="meta-item"
                  onClick={() => applyMeta(item)}
                >
                  {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <div style={{ width: 42 }} />}
                  <div>
                    <strong>{item.title || "Adsız"}</strong>
                    <div className="muted">
                      {item.author || "—"} · {item.source}
                      <span className="muted"> · düzenlediğiniz alanlar korunur</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Aktarılıyor…" : "İçe aktar"}
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
              Vazgeç
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
