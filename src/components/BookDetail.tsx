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
import { formatInvokeError, type ToastKind } from "./Toast";

interface Props {
  book: Book;
  onChange: (book: Book) => void;
  onBack: () => void;
  onRead: (book: Book) => void;
  onDeleted: () => void;
  onNotify?: (kind: ToastKind, text: string) => void;
}

export function BookDetail({
  book,
  onChange,
  onBack,
  onRead,
  onDeleted,
  onNotify,
}: Props) {
  const [draft, setDraft] = useState(book);
  const [tags, setTags] = useState(book.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    setDraft(book);
    setTags(book.tags.join(", "));
  }, [book]);

  const cover = assetUrl(draft.coverPath);
  const kind = normalizeFileType(draft.fileType);
  const canRead = isReadableBook(draft);
  const isPhysical = kind === "physical" || !draft.filePath;

  function notify(kind: ToastKind, text: string) {
    setBanner({
      kind: kind === "error" ? "error" : "success",
      text,
    });
    onNotify?.(kind, text);
  }

  async function save() {
    setSaving(true);
    setBanner(null);
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
      setDraft(updated);
      onChange(updated);
      notify("success", "Kaydedildi.");
    } catch (err) {
      notify("error", `Kaydetme başarısız: ${formatInvokeError(err)}`);
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
      if (!found.length) notify("info", "Metadata bulunamadı veya çevrimdışısınız.");
    } catch {
      notify("error", "Çevrimiçi arama başarısız.");
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
        notify("success", "Kapak uygulandı.");
      } catch {
        notify("error", "Kapak indirilemedi.");
      }
    }
  }

  async function remove() {
    if (!confirm(`“${draft.title}” silinsin mi?`)) return;
    try {
      await api.deleteBook(draft.id);
      onNotify?.("success", "Kitap silindi.");
      onDeleted();
    } catch (err) {
      notify("error", `Silinemedi: ${formatInvokeError(err)}`);
    }
  }

  async function attachFile(andRead: boolean) {
    let selectedPath: string | string[] | null;
    try {
      selectedPath = await open({
        multiple: false,
        filters: [{ name: "Kitap", extensions: ["pdf", "epub"] }],
      });
    } catch (err) {
      notify("error", `Dosya seçilemedi: ${formatInvokeError(err)}`);
      return;
    }
    if (selectedPath == null) {
      notify("info", "Dosya seçimi iptal edildi.");
      return;
    }
    if (typeof selectedPath !== "string") {
      notify("error", "Geçersiz dosya yolu.");
      return;
    }
    setAttachBusy(true);
    setBanner(null);
    try {
      const next = await api.attachBookFile(draft.id, selectedPath);
      setDraft(next);
      onChange(next);
      notify(
        "success",
        "PDF/EPUB kitaplığa kopyalandı. Okuyucu açılıyor…",
      );
      if (andRead) {
        onRead(next);
      }
    } catch (err) {
      notify("error", `Dosya bağlanamadı: ${formatInvokeError(err)}`);
    } finally {
      setAttachBusy(false);
    }
  }

  function handleRead() {
    if (!isReadableBook(draft)) {
      notify(
        "error",
        "Okunabilir PDF/EPUB yok. Önce “PDF/EPUB bağla ve oku” ile dosya ekleyin.",
      );
      return;
    }
    onNotify?.("info", `“${draft.title}” okuyucuda açılıyor…`);
    onRead(draft);
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Kütüphane
        </button>
        {canRead ? (
          <button type="button" className="btn btn-primary btn-oku" onClick={handleRead}>
            Oku
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={attachBusy}
            onClick={() => void attachFile(true)}
          >
            {attachBusy ? "Kopyalanıyor…" : "PDF/EPUB bağla ve oku"}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button type="button" className="btn btn-danger" onClick={() => void remove()}>
          Sil
        </button>
      </div>

      {banner && (
        <div className={`inline-banner inline-banner-${banner.kind}`}>{banner.text}</div>
      )}

      {!canRead && (
        <p className="reader-hint-banner">
          {isPhysical
            ? "Bu kayıt fiziksel kitap olarak eklendi; uygulama içi okuyucu yok. Sahip olduğunuz PDF veya EPUB dosyasını “PDF/EPUB bağla ve oku” ile ekleyin — kaynak dosya yönetilen kitaplığa kopyalanır, orijinal dokunulmaz; ardından okuyucu açılır."
            : "Okunabilir dosya yolu eksik. PDF/EPUB bağlayarak okuyucuyu açabilirsiniz."}
        </p>
      )}
      {canRead && (
        <p className="muted" style={{ marginTop: 0 }}>
          Dosya yönetilen kitaplıkta. Okumak için <strong>Oku</strong> düğmesine basın.
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
            Puan (0–5)
            <input
              type="number"
              min={0}
              max={5}
              value={draft.rating ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  rating: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            İlerleme (%)
            <input
              type="number"
              min={0}
              max={100}
              value={draft.progress}
              onChange={(e) => setDraft({ ...draft, progress: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            Sayfa
            <input
              type="number"
              min={0}
              value={draft.currentPage ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  currentPage: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Toplam sayfa
            <input
              type="number"
              min={0}
              value={draft.pageCount ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  pageCount: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Etiketler (virgülle)
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
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
            <button type="button" className="btn btn-primary" onClick={handleRead}>
              Okumaya başla
            </button>
          )}
          {!canRead && (
            <button
              type="button"
              className="btn"
              disabled={attachBusy}
              onClick={() => void attachFile(true)}
            >
              {attachBusy ? "Kopyalanıyor…" : "PDF veya EPUB dosyası seç"}
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
                  notify("success", "Kapak EPUB dosyasından alındı.");
                } catch (err) {
                  notify("error", formatInvokeError(err));
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
        </div>
      </div>
    </div>
  );
}
