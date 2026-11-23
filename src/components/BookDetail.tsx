import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, assetUrl } from "../api";
import { isReadableBook, normalizeFileType } from "../lib/books";
import {
  STATUS_LABELS,
  STATUS_OPTIONS,
  type Book,
  type MetadataResult,
} from "../types";

interface Props {
  book: Book;
  onChange: (book: Book) => void;
  onBack: () => void;
  onRead: (book: Book) => void;
  onDeleted: () => void;
}

export function BookDetail({ book, onChange, onBack, onRead, onDeleted }: Props) {
  const [draft, setDraft] = useState(book);
  const [tags, setTags] = useState(book.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(book);
    setTags(book.tags.join(", "));
  }, [book]);

  const cover = assetUrl(draft.coverPath);
  const kind = normalizeFileType(draft.fileType);
  const canRead = isReadableBook(draft);
  const isPhysical = kind === "physical" || !draft.filePath;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api.updateBook(draft.id, {
        title: draft.title,
        author: draft.author,
        isbn: draft.isbn,
        status: draft.status,
        rating: draft.rating,
        review: draft.review,
        progress: draft.progress,
        currentPage: draft.currentPage,
        pageCount: draft.pageCount,
        startedAt: draft.startedAt,
        finishedAt: draft.finishedAt,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onChange(updated);
      setMessage("Kaydedildi.");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function searchMeta() {
    setMetaBusy(true);
    try {
      const found = await api.searchOnlineMetadata(
        draft.title || draft.author || "",
        draft.isbn || undefined,
      );
      setResults(found);
      if (!found.length) setMessage("Metadata bulunamadı veya çevrimdışısınız.");
    } catch {
      setMessage("Çevrimiçi arama başarısız.");
      setResults([]);
    } finally {
      setMetaBusy(false);
    }
  }

  async function applyMeta(item: MetadataResult) {
    let next = {
      ...draft,
      title: item.title || draft.title,
      author: item.author || draft.author,
      isbn: item.isbn || draft.isbn,
    };
    setDraft(next);
    if (item.coverUrl) {
      try {
        next = await api.applyCoverFromUrl(draft.id, item.coverUrl);
        setDraft(next);
        onChange(next);
      } catch {
        setMessage("Kapak indirilemedi.");
      }
    }
  }

  async function remove() {
    if (!confirm(`“${draft.title}” silinsin mi?`)) return;
    await api.deleteBook(draft.id);
    onDeleted();
  }

  async function attachFile() {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "Kitap", extensions: ["pdf", "epub"] }],
    });
    if (typeof selectedPath !== "string") return;
    setAttachBusy(true);
    setMessage(null);
    try {
      const next = await api.attachBookFile(draft.id, selectedPath);
      setDraft(next);
      onChange(next);
      setMessage("PDF/EPUB bağlandı. Artık Oku ile açabilirsiniz.");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setAttachBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Kütüphane
        </button>
        {canRead ? (
          <button className="btn btn-primary btn-oku" onClick={() => onRead(draft)}>
            Oku
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={attachBusy}
            onClick={() => void attachFile()}
          >
            {attachBusy ? "Bağlanıyor…" : "PDF/EPUB bağla ve oku"}
          </button>
        )}
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button className="btn btn-danger" onClick={remove}>
          Sil
        </button>
      </div>

      {!canRead && (
        <p className="reader-hint-banner">
          {isPhysical
            ? "Bu kayıt fiziksel kitap olarak eklendi; uygulama içi okuyucu yok. Sahip olduğunuz PDF veya EPUB dosyasını “PDF/EPUB bağla ve oku” ile ekleyin (kaynak dosya kopyalanır, orijinal dokunulmaz)."
            : "Okunabilir dosya yolu eksik. PDF/EPUB bağlayarak okuyucuyu açabilirsiniz."}
        </p>
      )}
      {canRead && (
        <p className="muted" style={{ marginTop: 0 }}>
          Okumak için yeşil <strong>Oku</strong> düğmesine basın — veya kütüphanedeki karttaki Oku’yu
          kullanın.
        </p>
      )}

      <div className="detail-layout">
        <div className="detail-cover">
          {cover ? <img src={cover} alt="" /> : <div className="cover-fallback">{draft.title}</div>}
        </div>
        <div className="form-grid">
          <label>
            Başlık
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Yazar
            <input
              value={draft.author || ""}
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
            />
          </label>
          <label>
            ISBN
            <input
              value={draft.isbn || ""}
              onChange={(e) => setDraft({ ...draft, isbn: e.target.value })}
            />
          </label>
          <label>
            Durum
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Etiketler
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div>
            <span className="muted">Puan</span>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`star ${draft.rating && draft.rating >= n ? "on" : ""}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      rating: draft.rating === n ? null : n,
                    })
                  }
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <label>
            İlerleme (%)
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(draft.progress)}
              onChange={(e) =>
                setDraft({ ...draft, progress: Number(e.target.value) || 0 })
              }
            />
          </label>
          <div className="row">
            <label style={{ flex: 1 }}>
              Başlangıç
              <input
                type="date"
                value={draft.startedAt?.slice(0, 10) || ""}
                onChange={(e) =>
                  setDraft({ ...draft, startedAt: e.target.value || null })
                }
              />
            </label>
            <label style={{ flex: 1 }}>
              Bitiş
              <input
                type="date"
                value={draft.finishedAt?.slice(0, 10) || ""}
                onChange={(e) =>
                  setDraft({ ...draft, finishedAt: e.target.value || null })
                }
              />
            </label>
          </div>
          <label>
            İnceleme
            <textarea
              value={draft.review || ""}
              onChange={(e) => setDraft({ ...draft, review: e.target.value })}
            />
          </label>
          <p className="muted">
            Tür:{" "}
            {kind === "physical"
              ? "Fiziksel (okuyucu yok — dosya bağlayın)"
              : draft.fileType.toUpperCase()}
            {draft.filePath ? " · dosya yönetilen kitaplıkta" : ""}
          </p>
          {canRead && (
            <button type="button" className="btn btn-primary" onClick={() => onRead(draft)}>
              Okumaya başla
            </button>
          )}
          {!canRead && (
            <button
              type="button"
              className="btn"
              disabled={attachBusy}
              onClick={() => void attachFile()}
            >
              {attachBusy ? "Bağlanıyor…" : "PDF veya EPUB dosyası seç"}
            </button>
          )}
          {kind === "epub" && draft.filePath && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  const next = await api.extractEpubCover(draft.id);
                  setDraft(next);
                  onChange(next);
                  setMessage("Kapak EPUB dosyasından alındı.");
                } catch (err) {
                  setMessage(String(err));
                }
              }}
            >
              Kapak çıkar
            </button>
          )}
          <div className="row">
            {draft.tags.map((t) => (
              <span className="tag-chip" key={t}>
                {t}
              </span>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={searchMeta} disabled={metaBusy}>
              {metaBusy ? "Aranıyor…" : "Metadata ara"}
            </button>
          </div>
          {!!results.length && (
            <div className="meta-results">
              {results.map((item, i) => (
                <button
                  key={`${item.source}-${i}`}
                  type="button"
                  className="meta-item"
                  onClick={() => applyMeta(item)}
                >
                  {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" />
                  ) : (
                    <div style={{ width: 42 }} />
                  )}
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
          {message && <p className="muted">{message}</p>}
        </div>
      </div>
    </div>
  );
}
