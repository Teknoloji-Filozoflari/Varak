import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { BackupPanel } from "./components/BackupPanel";
import { BookCard } from "./components/BookCard";
import { BookDetail } from "./components/BookDetail";
import { BookForm } from "./components/BookForm";
import { EpubReader } from "./components/EpubReader";
import { ImportPreviewModal } from "./components/ImportPreviewModal";
import { PdfReader } from "./components/PdfReader";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { formatInvokeError, Toast, type ToastState } from "./components/Toast";
import { isReadableBook, normalizeFileType } from "./lib/books";
import {
  STATUS_LABELS,
  STATUS_OPTIONS,
  type AppSettings,
  type Book,
  type ImportPreview,
} from "./types";

type View = "library" | "add" | "detail" | "settings" | "backup" | "stats";

function resolveTheme(theme: string): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("library");
  const [selected, setSelected] = useState<Book | null>(null);
  const [reading, setReading] = useState<Book | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const notify = useCallback((kind: ToastState["kind"], text: string) => {
    setToast({ kind, text });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, tagList, appSettings] = await Promise.all([
        api.listBooks({
          query: query || null,
          status: status === "all" ? null : status,
          tag,
        }),
        api.listTags(),
        api.getSettings(),
      ]);
      setBooks(list);
      setTags(tagList);
      setSettings(appSettings);
      document.documentElement.setAttribute("data-theme", resolveTheme(appSettings.theme));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [query, status, tag]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.setAttribute("data-theme", resolveTheme("system"));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: books.length };
    for (const s of STATUS_OPTIONS) map[s] = 0;
    for (const b of books) map[b.status] = (map[b.status] || 0) + 1;
    return map;
  }, [books]);

  async function importFile() {
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
      notify("info", "İçe aktarma iptal edildi.");
      return;
    }
    if (typeof selectedPath !== "string") {
      notify("error", "Geçersiz dosya yolu.");
      return;
    }
    try {
      const preview = await api.previewImport(selectedPath);
      setImportPreview(preview);
    } catch (err) {
      const msg = formatInvokeError(err);
      setError(msg);
      notify("error", `Önizleme başarısız: ${msg}`);
    }
  }

  function openBook(book: Book) {
    setSelected(book);
    setView("detail");
  }

  function startReading(book: Book) {
    if (!isReadableBook(book)) {
      setSelected(book);
      setView("detail");
      const msg =
        "Bu kitapta okunabilir PDF/EPUB yok. Detayda “PDF/EPUB bağla ve oku” ile dosya ekleyin.";
      setError(msg);
      notify("error", msg);
      return;
    }
    setError(null);
    notify("info", `“${book.title}” okuyucuda açılıyor…`);
    setReading(book);
  }

  if (reading) {
    const kind = normalizeFileType(reading.fileType);
    const closeReader = () => {
      setReading(null);
      void refresh();
    };
    const onProgress = (b: Book) => {
      setReading(b);
      setSelected(b);
    };
    let reader: ReactNode;
    if (kind === "pdf") {
      reader = (
        <PdfReader
          book={reading}
          onClose={closeReader}
          onProgress={onProgress}
          onNotify={notify}
        />
      );
    } else if (kind === "epub") {
      reader = (
        <EpubReader
          book={reading}
          onClose={closeReader}
          onProgress={onProgress}
          onNotify={notify}
        />
      );
    } else {
      reader = (
        <div className="panel" style={{ margin: "2rem auto", maxWidth: 480 }}>
          <h2>Okuyucu açılamadı</h2>
          <p className="muted">
            Desteklenmeyen veya eksik dosya türü: {reading.fileType || "bilinmiyor"}.
          </p>
          <button type="button" className="btn btn-primary" onClick={closeReader}>
            Kütüphaneye dön
          </button>
        </div>
      );
    }
    return (
      <div className="app-shell">
        <Toast toast={toast} onClose={() => setToast(null)} />
        {reader}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <header className="topbar">
        <h1 className="brand">
          Var<span>ak</span>
        </h1>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setView("add")}>
            Kitap ekle
          </button>
          <button className="btn" onClick={() => void importFile()}>
            PDF/EPUB içe aktar
          </button>
          <button className="btn btn-ghost" onClick={() => setView("stats")}>
            İstatistikler
          </button>
          <button className="btn btn-ghost" onClick={() => setView("backup")}>
            Yedek
          </button>
          <button className="btn btn-ghost" onClick={() => setView("settings")}>
            Ayarlar
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="side-label">Raflar</div>
          <button
            className={`side-btn ${status === "all" && !tag ? "active" : ""}`}
            onClick={() => {
              setStatus("all");
              setTag(null);
              setView("library");
            }}
          >
            Tümü
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              className={`side-btn ${status === s && !tag ? "active" : ""}`}
              onClick={() => {
                setStatus(s);
                setTag(null);
                setView("library");
              }}
            >
              {STATUS_LABELS[s]}
              {typeof counts[s] === "number" ? ` (${counts[s]})` : ""}
            </button>
          ))}
          {!!tags.length && <div className="side-label">Etiketler</div>}
          {tags.map((t) => (
            <button
              key={t}
              className={`side-btn ${tag === t ? "active" : ""}`}
              onClick={() => {
                setTag(t);
                setStatus("all");
                setView("library");
              }}
            >
              {t}
            </button>
          ))}
        </aside>

        <main className="content">
          {view === "add" && (
            <BookForm
              onCancel={() => setView("library")}
              onCreated={(book) => {
                setSelected(book);
                setView("detail");
                void refresh();
              }}
            />
          )}

          {view === "settings" && settings && (
            <SettingsPanel
              settings={settings}
              onChange={(s) => {
                setSettings(s);
                document.documentElement.setAttribute("data-theme", resolveTheme(s.theme));
              }}
              onClose={() => setView("library")}
              onOpenBackup={() => setView("backup")}
            />
          )}

          {view === "backup" && (
            <BackupPanel onDone={() => void refresh()} onClose={() => setView("library")} />
          )}

          {view === "stats" && <StatsPanel onClose={() => setView("library")} />}

          {view === "detail" && selected && (
            <BookDetail
              book={selected}
              onBack={() => setView("library")}
              onChange={(b) => {
                setSelected(b);
                void refresh();
              }}
              onRead={startReading}
              onNotify={notify}
              onDeleted={() => {
                setSelected(null);
                setView("library");
                void refresh();
              }}
            />
          )}

          {view === "library" && (
            <>
              <div className="toolbar">
                <input
                  className="search"
                  placeholder="Başlık, yazar veya ISBN ara…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="btn" onClick={() => void refresh()}>
                  Yenile
                </button>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                PDF/EPUB için karttaki <strong>Oku</strong> düğmesine basın. Fiziksel kayıtlarda önce
                detaydan dosya bağlayın.
              </p>
              {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
              {loading ? (
                <p className="empty">Yükleniyor…</p>
              ) : books.length === 0 ? (
                <div className="empty">
                  <p>Kitaplığınız boş.</p>
                  <p>Fiziksel kitap ekleyin veya PDF/EPUB içe aktarın.</p>
                </div>
              ) : (
                <div className="book-grid">
                  {books.map((book, i) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      onOpen={openBook}
                      onRead={startReading}
                      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          onCancel={() => setImportPreview(null)}
          onImported={(book) => {
            setImportPreview(null);
            setSelected(book);
            void refresh();
            notify(
              "success",
              `“${book.title}” kitaplığa kopyalandı. Okuyucu açılıyor…`,
            );
            startReading(book);
          }}
        />
      )}
    </div>
  );
}
