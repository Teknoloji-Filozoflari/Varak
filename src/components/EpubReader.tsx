import ePub, {
  type Book as EpubBook,
  type NavItem,
  type Rendition,
} from "epubjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fileToBlobUrl } from "../api";
import type { Annotation, Book } from "../types";

interface Props {
  book: Book;
  onClose: () => void;
  onProgress: (book: Book) => void;
}

type ReaderTheme = "light" | "sepia" | "dark";

const FONT_MIN = 80;
const FONT_MAX = 180;
const FONT_STEP = 10;

const THEME_STYLES: Record<ReaderTheme, Record<string, Record<string, string>>> = {
  light: {
    body: { background: "#fffdf8", color: "#15241f" },
    a: { color: "#0c6b52" },
  },
  sepia: {
    body: { background: "#f4ecd8", color: "#3b2f1c" },
    a: { color: "#7a4e1d" },
  },
  dark: {
    body: { background: "#121816", color: "#e8f0ea" },
    a: { color: "#4ec9a4" },
  },
};

export function EpubReader({ book, onClose, onProgress }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState("");
  const [selection, setSelection] = useState("");
  const [selectionCfi, setSelectionCfi] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<ReaderTheme>("light");
  const [panelOpen, setPanelOpen] = useState(true);
  const saveTimer = useRef<number | null>(null);
  const latestCfi = useRef<string | null>(null);
  const bookMeta = useRef({ startedAt: book.startedAt, finishedAt: book.finishedAt });
  const positionReady = useRef(false);

  useEffect(() => {
    bookMeta.current = { startedAt: book.startedAt, finishedAt: book.finishedAt };
  }, [book.startedAt, book.finishedAt]);

  const applyChrome = useCallback((rendition: Rendition, size: number, t: ReaderTheme) => {
    rendition.themes.register("light", THEME_STYLES.light);
    rendition.themes.register("sepia", THEME_STYLES.sepia);
    rendition.themes.register("dark", THEME_STYLES.dark);
    rendition.themes.select(t);
    rendition.themes.fontSize(`${size}%`);
  }, []);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    positionReady.current = false;
    (async () => {
      if (!book.filePath || !hostRef.current) {
        setError("Dosya yolu yok.");
        return;
      }
      try {
        const url = await fileToBlobUrl(book.filePath, "application/epub+zip");
        revoked = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        const epubBook = ePub(url);
        bookRef.current = epubBook;
        const rendition = epubBook.renderTo(hostRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        const saved = await api.getReadingPosition(book.id);
        let cfi: string | undefined;
        let startFont = 100;
        let startTheme: ReaderTheme = "light";
        if (saved?.positionJson) {
          try {
            const parsed = JSON.parse(saved.positionJson);
            cfi = parsed.cfi;
            if (parsed.fontSize) startFont = parsed.fontSize;
            if (parsed.theme === "sepia" || parsed.theme === "dark" || parsed.theme === "light") {
              startTheme = parsed.theme;
            }
          } catch {
            /* ignore */
          }
        }
        setFontSize(startFont);
        setTheme(startTheme);
        applyChrome(rendition, startFont, startTheme);
        await rendition.display(cfi);
        latestCfi.current = cfi || null;

        const navigation = await epubBook.loaded.navigation;
        setToc(navigation.toc || []);
        const anns = await api.listAnnotations(book.id);
        setNotes(anns);
        for (const ann of anns) {
          if (ann.kind !== "highlight") continue;
          try {
            const loc = JSON.parse(ann.locationJson);
            if (loc.cfiRange) {
              rendition.annotations.highlight(
                loc.cfiRange,
                {},
                undefined,
                "hl",
                { fill: ann.color || "#f6e05e", "fill-opacity": "0.35" },
              );
            }
          } catch {
            /* ignore */
          }
        }
        positionReady.current = true;
        setReady(true);

        rendition.on("relocated", (loc: { start: { cfi: string; percentage?: number } }) => {
          const percentage = Math.round((loc.start.percentage || 0) * 1000) / 10;
          setLocationLabel(`%${percentage}`);
          latestCfi.current = loc.start.cfi;
          if (!positionReady.current) return;
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            void persistPosition(loc.start.cfi, percentage);
          }, 400);
        });

        rendition.on("selected", (cfiRange: string, contents: { window: Window }) => {
          const text = contents.window.getSelection()?.toString().trim() || "";
          setSelection(text);
          setSelectionCfi(cfiRange);
          if (text) setNoteText(text);
        });
      } catch (err) {
        setError(String(err));
      }
    })();

    async function persistPosition(cfi: string, percentage: number) {
      const host = hostRef.current;
      const size = Number(host?.dataset.fontSize || 100);
      const t = (host?.dataset.theme as ReaderTheme) || "light";
      await api.saveReadingPosition(
        book.id,
        JSON.stringify({ cfi, kind: "epub", percentage, fontSize: size, theme: t }),
      );
      const meta = bookMeta.current;
      const updated = await api.updateBook(book.id, {
        progress: percentage,
        status: percentage >= 99 ? "okudum" : "okuyorum",
        startedAt: meta.startedAt || new Date().toISOString().slice(0, 10),
        finishedAt:
          percentage >= 99 ? new Date().toISOString().slice(0, 10) : meta.finishedAt,
      });
      onProgress(updated);
    }

    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.id, book.filePath, onProgress, applyChrome]);

  useEffect(() => {
    if (hostRef.current) {
      hostRef.current.dataset.fontSize = String(fontSize);
      hostRef.current.dataset.theme = theme;
    }
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    applyChrome(rendition, fontSize, theme);
    // Persist chrome prefs with last cfi
    if (positionReady.current && latestCfi.current) {
      void api.saveReadingPosition(
        book.id,
        JSON.stringify({
          cfi: latestCfi.current,
          kind: "epub",
          fontSize,
          theme,
        }),
      );
    }
  }, [fontSize, theme, ready, applyChrome, book.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        void renditionRef.current?.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        void renditionRef.current?.prev();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setFontSize((s) => Math.min(FONT_MAX, s + FONT_STEP));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setFontSize((s) => Math.max(FONT_MIN, s - FONT_STEP));
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        void addAnnotation("bookmark");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  async function addAnnotation(kind: "note" | "highlight" | "bookmark") {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const loc = rendition.currentLocation();
    const resolved = loc instanceof Promise ? await loc : loc;
    const cfi = resolved?.start?.cfi;
    if (!cfi && !selectionCfi) return;

    const content =
      noteText.trim() ||
      selection.trim() ||
      (kind === "bookmark" ? "Yer imi" : kind === "highlight" ? "Vurgu" : "Not");
    if (kind !== "bookmark" && !noteText.trim() && !selection.trim()) return;

    const cfiRange = kind === "highlight" ? selectionCfi : null;
    if (kind === "highlight" && cfiRange) {
      try {
        rendition.annotations.highlight(
          cfiRange,
          {},
          undefined,
          "hl",
          { fill: "#f6e05e", "fill-opacity": "0.35" },
        );
      } catch {
        /* ignore draw errors */
      }
    }

    const ann = await api.addAnnotation({
      bookId: book.id,
      kind,
      content,
      color: kind === "highlight" ? "#f6e05e" : kind === "bookmark" ? "#4ec9a4" : "#d4a017",
      locationJson: JSON.stringify({
        cfi: cfi || selectionCfi,
        cfiRange: cfiRange || undefined,
      }),
    });
    setNotes((n) => [ann, ...n]);
    setNoteText("");
    setSelection("");
    setSelectionCfi(null);
  }

  async function removeNote(id: string) {
    const target = notes.find((n) => n.id === id);
    if (target?.kind === "highlight") {
      try {
        const loc = JSON.parse(target.locationJson);
        if (loc.cfiRange) renditionRef.current?.annotations.remove(loc.cfiRange, "highlight");
      } catch {
        /* ignore */
      }
    }
    await api.deleteAnnotation(id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  function goToAnnotation(locationJson: string) {
    try {
      const { cfi, cfiRange } = JSON.parse(locationJson);
      void renditionRef.current?.display(cfiRange || cfi);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={`reader-shell reader-epub theme-${theme}`}>
      <div className="reader-bar">
        <button className="btn btn-ghost" onClick={onClose} title="Esc">
          ← Kapat
        </button>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span className="muted reader-hint">
            ← → sayfa · +/- yazı boyutu · B yer imi · Esc kapat
          </span>
        </div>
        <span className="muted">{locationLabel || "—"}</span>
        <div className="row reader-tools">
          <button
            className="btn"
            disabled={fontSize <= FONT_MIN}
            onClick={() => setFontSize((s) => Math.max(FONT_MIN, s - FONT_STEP))}
            title="Yazıyı küçült"
          >
            A−
          </button>
          <span className="muted">{fontSize}%</span>
          <button
            className="btn"
            disabled={fontSize >= FONT_MAX}
            onClick={() => setFontSize((s) => Math.min(FONT_MAX, s + FONT_STEP))}
            title="Yazıyı büyüt"
          >
            A+
          </button>
          <select
            className="reader-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ReaderTheme)}
            aria-label="Okuyucu teması"
          >
            <option value="light">Açık</option>
            <option value="sepia">Sepya</option>
            <option value="dark">Koyu</option>
          </select>
          <button className="btn" onClick={() => void renditionRef.current?.prev()}>
            Önceki
          </button>
          <button className="btn" onClick={() => void renditionRef.current?.next()}>
            Sonraki
          </button>
          {!!toc.length && (
            <select
              className="reader-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) void renditionRef.current?.display(e.target.value);
              }}
              aria-label="İçindekiler"
            >
              <option value="" disabled>
                İçindekiler
              </option>
              {toc.map((item) => (
                <option key={item.id || item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost" onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "Notları gizle" : "Notları göster"}
          </button>
        </div>
      </div>

      <div
        className="reader-stage epub-stage"
        style={{
          background:
            theme === "dark" ? "#121816" : theme === "sepia" ? "#f4ecd8" : "#fffdf8",
        }}
      >
        {error && <p className="empty">{error}</p>}
        {!ready && !error && <p className="empty">EPUB yükleniyor…</p>}
        <div id="epub-root" className="epub-view" ref={hostRef} />
      </div>

      {panelOpen && (
        <div className="reader-notes">
          {selection && (
            <p className="reader-selection muted">
              Seçim: “{selection.slice(0, 120)}
              {selection.length > 120 ? "…" : ""}”
            </p>
          )}
          <div className="row">
            <input
              className="search"
              placeholder="Not / vurgu / yer imi (metin seçerek doldurulur)"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button className="btn" onClick={() => void addAnnotation("note")}>
              Not
            </button>
            <button
              className="btn"
              onClick={() => void addAnnotation("highlight")}
              disabled={!selectionCfi}
            >
              Vurgu
            </button>
            <button className="btn" onClick={() => void addAnnotation("bookmark")}>
              Yer imi
            </button>
          </div>
          <div className="note-list">
            {notes.length === 0 && (
              <p className="muted">
                Henüz not yok. Metin seçip vurgu ekleyebilir veya yer imi koyabilirsiniz.
              </p>
            )}
            {notes.map((n) => (
              <div className="note-item" key={n.id}>
                <button className="btn-ghost note-jump" onClick={() => goToAnnotation(n.locationJson)}>
                  <strong>
                    {n.kind === "bookmark"
                      ? "Yer imi"
                      : n.kind === "highlight"
                        ? "Vurgu"
                        : "Not"}
                  </strong>{" "}
                  — {n.content}
                </button>
                <button className="btn btn-danger" onClick={() => void removeNote(n.id)}>
                  Sil
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
