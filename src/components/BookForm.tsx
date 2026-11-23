import { useState } from "react";
import { api } from "../api";
import {
  STATUS_LABELS,
  STATUS_OPTIONS,
  type Book,
  type MetadataResult,
} from "../types";

interface Props {
  onCreated: (book: Book) => void;
  onCancel: () => void;
}

export function BookForm({ onCreated, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [status, setStatus] = useState("okunacak");
  const [tags, setTags] = useState("");
  const [review, setReview] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [pendingCover, setPendingCover] = useState<string | null>(null);

  async function searchMeta() {
    setMetaBusy(true);
    setMetaError(null);
    try {
      const found = await api.searchOnlineMetadata(title || author, isbn || undefined);
      setResults(found);
      if (!found.length) setMetaError("Sonuç bulunamadı veya çevrimdışısınız.");
    } catch {
      setMetaError("Çevrimiçi arama başarısız (ağ yok veya servis kapalı).");
      setResults([]);
    } finally {
      setMetaBusy(false);
    }
  }

  function applyMeta(item: MetadataResult) {
    if (item.title) setTitle(item.title);
    if (item.author) setAuthor(item.author);
    if (item.isbn) setIsbn(item.isbn);
    if (item.coverUrl) setPendingCover(item.coverUrl);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Başlık gerekli.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let book = await api.createBook({
        title: title.trim(),
        author: author.trim() || null,
        isbn: isbn.trim() || null,
        status,
        rating,
        review: review.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (pendingCover) {
        try {
          book = await api.applyCoverFromUrl(book.id, pendingCover);
        } catch {
          // soft-fail cover download
        }
      }
      onCreated(book);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Fiziksel kitap ekle</h2>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Başlık
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Yazar
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label>
          ISBN
          <input value={isbn} onChange={(e) => setIsbn(e.target.value)} />
        </label>
        <label>
          Durum
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etiketler (virgülle)
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="roman, bilim, kişisel"
          />
        </label>
        <div>
          <span className="muted">Puan</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star ${rating && rating >= n ? "on" : ""}`}
                onClick={() => setRating(rating === n ? null : n)}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <label>
          İnceleme
          <textarea value={review} onChange={(e) => setReview(e.target.value)} />
        </label>

        <div className="row">
          <button type="button" className="btn" onClick={searchMeta} disabled={metaBusy}>
            {metaBusy ? "Aranıyor…" : "Çevrimiçi metadata ara"}
          </button>
          {pendingCover && <span className="muted">Kapak seçildi</span>}
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
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Vazgeç
          </button>
        </div>
      </form>
    </div>
  );
}
