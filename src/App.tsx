import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { BookCard } from "./components/BookCard";
import { BookDetail } from "./components/BookDetail";
import { BookForm } from "./components/BookForm";
import { EpubReader } from "./components/EpubReader";
import { PdfReader } from "./components/PdfReader";
import { SettingsPanel } from "./components/SettingsPanel";
import { STATUS_LABELS, STATUS_OPTIONS, type AppSettings, type Book } from "./types";

type View = "library" | "add" | "detail" | "settings";

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
    // counts from filtered list are imperfect; keep simple from current list
    for (const b of books) map[b.status] = (map[b.status] || 0) + 1;
    return map;
  }, [books]);

  async function importFile() {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "Kitap", extensions: ["pdf", "epub"] }],
    });
    if (typeof selectedPath !== "string") return;
    try {
      const book = await api.importBookFile(selectedPath);
      setSelected(book);
      setView("detail");
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function openBook(book: Book) {
    setSelected(book);
    setView("detail");
  }

  if (reading) {
    if (reading.fileType === "pdf") {
      return (
        <PdfReader
          book={reading}
          onClose={() => {
            setReading(null);
            void refresh();
          }}
          onProgress={(b) => {
            setReading(b);
            setSelected(b);
          }}
        />
      );
    }
    if (reading.fileType === "epub") {
      return (
        <EpubReader
          book={reading}
          onClose={() => {
            setReading(null);
            void refresh();
          }}
          onProgress={(b) => {
            setReading(b);
            setSelected(b);
          }}
        />
      );
    }
  }

  return (
    <div className="app-shell">
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
            />
          )}

          {view === "detail" && selected && (
            <BookDetail
              book={selected}
              onBack={() => setView("library")}
              onChange={(b) => {
                setSelected(b);
                void refresh();
              }}
              onRead={(b) => setReading(b)}
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
                      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
