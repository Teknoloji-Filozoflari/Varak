import ePub, { type Book as EpubBook, type NavItem, type Rendition } from "epubjs";
import { useEffect, useRef, useState } from "react";
import { api, fileToBlobUrl } from "../api";
import type { Annotation, Book } from "../types";

interface Props {
  book: Book;
  onClose: () => void;
  onProgress: (book: Book) => void;
}

export function EpubReader({ book, onClose, onProgress }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
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
        });
        renditionRef.current = rendition;

        const saved = await api.getReadingPosition(book.id);
        let cfi: string | undefined;
        if (saved?.positionJson) {
          try {
            cfi = JSON.parse(saved.positionJson).cfi;
          } catch {
            /* ignore */
          }
        }
        await rendition.display(cfi);
        const navigation = await epubBook.loaded.navigation;
        setToc(navigation.toc || []);
        setNotes(await api.listAnnotations(book.id));
        setReady(true);

        rendition.on("relocated", (loc: { start: { cfi: string; percentage?: number } }) => {
          const percentage = Math.round(((loc.start.percentage || 0) * 1000)) / 10;
          setLocationLabel(`%${percentage}`);
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(async () => {
            await api.saveReadingPosition(
              book.id,
              JSON.stringify({ cfi: loc.start.cfi, kind: "epub", percentage }),
            );
            const updated = await api.updateBook(book.id, {
              progress: percentage,
              status: percentage >= 99 ? "okudum" : "okuyorum",
              startedAt: book.startedAt || new Date().toISOString().slice(0, 10),
              finishedAt:
                percentage >= 99
                  ? new Date().toISOString().slice(0, 10)
                  : book.finishedAt,
            });
            onProgress(updated);
          }, 450);
        });
      } catch (err) {
        setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.id, book.filePath, book.startedAt, book.finishedAt, onProgress]);

  async function addNote(kind: "note" | "highlight" | "bookmark") {
    const loc = renditionRef.current?.currentLocation() as
      | { start?: { cfi?: string } }
      | undefined;
    const cfi = loc?.start?.cfi;
    if (!cfi) return;
    const ann = await api.addAnnotation({
      bookId: book.id,
      kind,
      content: noteText.trim() || (kind === "bookmark" ? "Yer imi" : "Vurgu"),
      color: kind === "highlight" ? "#f6e05e" : "#4ec9a4",
      locationJson: JSON.stringify({ cfi }),
    });
    setNotes((n) => [ann, ...n]);
    setNoteText("");
  }

  async function removeNote(id: string) {
    await api.deleteAnnotation(id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  function goToAnnotation(locationJson: string) {
    try {
      const { cfi } = JSON.parse(locationJson);
      if (cfi) renditionRef.current?.display(cfi);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="reader-shell">
      <div className="reader-bar">
        <button className="btn btn-ghost" onClick={onClose}>
          ← Kapat
        </button>
        <strong>{book.title}</strong>
        <span className="muted">{locationLabel}</span>
        <div className="row" style={{ marginLeft: "auto" }}>
          <button className="btn" onClick={() => renditionRef.current?.prev()}>
            Önceki
          </button>
          <button className="btn" onClick={() => renditionRef.current?.next()}>
            Sonraki
          </button>
          {!!toc.length && (
            <select
              className="search"
              style={{ maxWidth: 220 }}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) renditionRef.current?.display(e.target.value);
              }}
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
        </div>
      </div>
      <div className="reader-stage" style={{ background: "var(--surface-solid)" }}>
        {error && <p className="empty">{error}</p>}
        {!ready && !error && <p className="empty">EPUB yükleniyor…</p>}
        <div id="epub-root" className="epub-view" ref={hostRef} />
      </div>
      <div className="reader-notes">
        <div className="row">
          <input
            className="search"
            placeholder="Not / vurgu / yer imi"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <button className="btn" onClick={() => addNote("note")}>
            Not
          </button>
          <button className="btn" onClick={() => addNote("highlight")}>
            Vurgu
          </button>
          <button className="btn" onClick={() => addNote("bookmark")}>
            Yer imi
          </button>
        </div>
        <div className="note-list">
          {notes.map((n) => (
            <div className="note-item" key={n.id}>
              <button
                className="btn-ghost"
                style={{ border: 0, background: "transparent", textAlign: "left", flex: 1 }}
                onClick={() => goToAnnotation(n.locationJson)}
              >
                <strong>
                  {n.kind === "bookmark"
                    ? "Yer imi"
                    : n.kind === "highlight"
                      ? "Vurgu"
                      : "Not"}
                </strong>{" "}
                — {n.content}
              </button>
              <button className="btn btn-danger" onClick={() => removeNote(n.id)}>
                Sil
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
