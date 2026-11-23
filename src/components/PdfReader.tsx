import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, fileToBlobUrl } from "../api";
import type { Annotation, Book } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Props {
  book: Book;
  onClose: () => void;
  onProgress: (book: Book) => void;
}

export function PdfReader({ book, onClose, onProgress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      if (!book.filePath) {
        setError("Dosya yolu yok.");
        return;
      }
      try {
        const url = await fileToBlobUrl(book.filePath, "application/pdf");
        revoked = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setBlobUrl(url);
        const doc = await pdfjs.getDocument(url).promise;
        if (cancelled) return;
        setPdf(doc);
        setPageCount(doc.numPages);
        const saved = await api.getReadingPosition(book.id);
        let startPage = book.currentPage || 1;
        if (saved?.positionJson) {
          try {
            const parsed = JSON.parse(saved.positionJson);
            if (parsed.page) startPage = parsed.page;
          } catch {
            /* ignore */
          }
        }
        setPage(Math.min(Math.max(1, startPage), doc.numPages));
        const anns = await api.listAnnotations(book.id);
        setNotes(anns);
      } catch (err) {
        setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.id, book.filePath, book.currentPage]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const pg = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = pg.getViewport({ scale: 1.35 });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  useEffect(() => {
    if (!pdf || !pageCount) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const progress = Math.round((page / pageCount) * 1000) / 10;
      await api.saveReadingPosition(
        book.id,
        JSON.stringify({ page, pageCount, kind: "pdf" }),
      );
      const updated = await api.updateBook(book.id, {
        currentPage: page,
        pageCount,
        progress,
        status: progress >= 99 ? "okudum" : "okuyorum",
        startedAt: book.startedAt || new Date().toISOString().slice(0, 10),
        finishedAt: progress >= 99 ? new Date().toISOString().slice(0, 10) : book.finishedAt,
      });
      onProgress(updated);
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [page, pageCount, pdf, book.id, book.startedAt, book.finishedAt, onProgress]);

  async function addBookmark() {
    const ann = await api.addAnnotation({
      bookId: book.id,
      kind: "bookmark",
      content: noteText.trim() || `Sayfa ${page}`,
      color: "#4ec9a4",
      locationJson: JSON.stringify({ page }),
    });
    setNotes((n) => [ann, ...n]);
    setNoteText("");
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const ann = await api.addAnnotation({
      bookId: book.id,
      kind: "note",
      content: noteText.trim(),
      color: "#d4a017",
      locationJson: JSON.stringify({ page }),
    });
    setNotes((n) => [ann, ...n]);
    setNoteText("");
  }

  async function removeNote(id: string) {
    await api.deleteAnnotation(id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  return (
    <div className="reader-shell">
      <div className="reader-bar">
        <button className="btn btn-ghost" onClick={onClose}>
          ← Kapat
        </button>
        <strong>{book.title}</strong>
        <span className="muted">
          Sayfa {page} / {pageCount || "—"}
        </span>
        <div className="row" style={{ marginLeft: "auto" }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Önceki
          </button>
          <button
            className="btn"
            disabled={!pageCount || page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Sonraki
          </button>
        </div>
      </div>
      <div className="reader-stage">
        {error ? (
          <p className="empty">{error}</p>
        ) : (
          <canvas ref={canvasRef} style={{ maxWidth: "100%" }} />
        )}
        {!pdf && !error && blobUrl === null && <p className="empty">PDF yükleniyor…</p>}
      </div>
      <div className="reader-notes">
        <div className="row">
          <input
            className="search"
            placeholder="Not veya yer imi metni"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <button className="btn" onClick={addNote}>
            Not ekle
          </button>
          <button className="btn" onClick={addBookmark}>
            Yer imi
          </button>
        </div>
        <div className="note-list">
          {notes.map((n) => (
            <div className="note-item" key={n.id}>
              <button
                className="btn-ghost"
                style={{ border: 0, background: "transparent", textAlign: "left", flex: 1 }}
                onClick={() => {
                  try {
                    const loc = JSON.parse(n.locationJson);
                    if (loc.page) setPage(loc.page);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <strong>{n.kind === "bookmark" ? "Yer imi" : "Not"}</strong> — {n.content}
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
