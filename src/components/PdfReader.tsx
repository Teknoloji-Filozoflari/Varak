import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, fileToBlobUrl } from "../api";
import type { Annotation, Book } from "../types";
import { formatInvokeError, type ToastKind } from "./Toast";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Props {
  book: Book;
  onClose: () => void;
  onProgress: (book: Book) => void;
  onNotify?: (kind: ToastKind, text: string) => void;
}

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.6;
const ZOOM_STEP = 0.15;

export function PdfReader({ book, onClose, onProgress, onNotify }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.25);
  const [pageInput, setPageInput] = useState("1");
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState("");
  const [selection, setSelection] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const saveTimer = useRef<number | null>(null);
  const positionReady = useRef(false);
  const bookMeta = useRef({ startedAt: book.startedAt, finishedAt: book.finishedAt });

  useEffect(() => {
    bookMeta.current = { startedAt: book.startedAt, finishedAt: book.finishedAt };
  }, [book.startedAt, book.finishedAt]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    positionReady.current = false;
    (async () => {
      if (!book.filePath) {
        const msg = "Dosya yolu yok. PDF’yi yeniden bağlayın.";
        setError(msg);
        onNotify?.("error", msg);
        setLoading(false);
        return;
      }
      try {
        const url = await fileToBlobUrl(book.filePath, "application/pdf");
        revoked = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        const doc = await pdfjs.getDocument(url).promise;
        if (cancelled) return;
        if (!doc.numPages) {
          throw new Error("PDF sayfa içermiyor (boş veya bozuk dosya).");
        }
        setPdf(doc);
        setPageCount(doc.numPages);
        const saved = await api.getReadingPosition(book.id);
        let startPage = book.currentPage || 1;
        let startZoom = 1.25;
        if (saved?.positionJson) {
          try {
            const parsed = JSON.parse(saved.positionJson);
            if (parsed.page) startPage = parsed.page;
            if (parsed.zoom) startZoom = parsed.zoom;
          } catch {
            /* ignore */
          }
        }
        setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom)));
        const p = Math.min(Math.max(1, startPage), doc.numPages);
        setPage(p);
        setPageInput(String(p));
        setNotes(await api.listAnnotations(book.id));
        positionReady.current = true;
        onNotify?.("success", `PDF yüklendi · ${doc.numPages} sayfa`);
      } catch (err) {
        const msg = `PDF açılamadı: ${formatInvokeError(err)}`;
        setError(msg);
        onNotify?.("error", msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.id, book.filePath, book.currentPage]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    (async () => {
      const pg = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = pg.getViewport({ scale: zoom });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const transform =
        outputScale !== 1 ? ([outputScale, 0, 0, outputScale, 0, 0] as const) : undefined;
      renderTask = pg.render({
        canvasContext: ctx,
        viewport,
        canvas,
        transform: transform as number[] | undefined,
      }) as { promise: Promise<void>; cancel: () => void };
      await renderTask.promise;

      const textLayerDiv = textLayerRef.current!;
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      const textContent = await pg.getTextContent();
      // Manual text layer (compatible across pdf.js versions)
      for (const item of textContent.items) {
        if (!("str" in item) || !item.str) continue;
        const m = viewport.transform;
        const it = item.transform as number[];
        const tx = [
          m[0] * it[0] + m[2] * it[1],
          m[1] * it[0] + m[3] * it[1],
          m[0] * it[2] + m[2] * it[3],
          m[1] * it[2] + m[3] * it[3],
          m[0] * it[4] + m[2] * it[5] + m[4],
          m[1] * it[4] + m[3] * it[5] + m[5],
        ];
        const span = document.createElement("span");
        span.textContent = item.str;
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.fontFamily = "sans-serif";
        span.style.transformOrigin = "0% 0%";
        const angle = Math.atan2(tx[1], tx[0]);
        if (angle) span.style.transform = `rotate(${angle}rad)`;
        textLayerDiv.appendChild(span);
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [pdf, page, zoom]);

  const persist = useCallback(
    async (nextPage: number, nextZoom: number, count: number) => {
      if (!positionReady.current || !count) return;
      const progress = Math.round((nextPage / count) * 1000) / 10;
      await api.saveReadingPosition(
        book.id,
        JSON.stringify({ page: nextPage, pageCount: count, zoom: nextZoom, kind: "pdf" }),
      );
      const meta = bookMeta.current;
      const updated = await api.updateBook(book.id, {
        currentPage: nextPage,
        pageCount: count,
        progress,
        status: progress >= 99 ? "okudum" : "okuyorum",
        startedAt: meta.startedAt || new Date().toISOString().slice(0, 10),
        finishedAt:
          progress >= 99 ? new Date().toISOString().slice(0, 10) : meta.finishedAt,
      });
      onProgress(updated);
    },
    [book.id, onProgress],
  );

  useEffect(() => {
    if (!pdf || !pageCount || !positionReady.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(page, zoom, pageCount);
    }, 350);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [page, zoom, pageCount, pdf, persist]);

  const goPage = useCallback(
    (next: number) => {
      if (!pageCount) return;
      const p = Math.min(Math.max(1, next), pageCount);
      setPage(p);
      setPageInput(String(p));
      setSelection("");
      stageRef.current?.scrollTo({ top: 0 });
    },
    [pageCount],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        goPage(page + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        goPage(page - 1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        void addBookmark();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageCount, goPage, onClose]);

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() || "";
    setSelection(sel);
    if (sel) setNoteText(sel);
  }

  async function addAnnotation(kind: "note" | "highlight" | "bookmark") {
    const content =
      noteText.trim() ||
      selection.trim() ||
      (kind === "bookmark" ? `Sayfa ${page}` : kind === "highlight" ? "Vurgu" : "Not");
    if (kind !== "bookmark" && !noteText.trim() && !selection.trim()) return;
    const ann = await api.addAnnotation({
      bookId: book.id,
      kind,
      content,
      color: kind === "highlight" ? "#f6e05e" : kind === "bookmark" ? "#4ec9a4" : "#d4a017",
      locationJson: JSON.stringify({ page, selected: selection || null }),
    });
    setNotes((n) => [ann, ...n]);
    setNoteText("");
    setSelection("");
    window.getSelection()?.removeAllRanges();
  }

  async function addBookmark() {
    await addAnnotation("bookmark");
  }

  async function removeNote(id: string) {
    await api.deleteAnnotation(id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  function submitPageJump(e: FormEvent) {
    e.preventDefault();
    const n = Number(pageInput);
    if (!Number.isFinite(n)) return;
    goPage(Math.round(n));
  }

  return (
    <div className="reader-shell">
      <div className="reader-bar">
        <button className="btn btn-ghost" onClick={onClose} title="Esc">
          ← Kapat
        </button>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span className="muted reader-hint">
            ← → sayfa · +/- yakınlaştır · B yer imi · Esc kapat
          </span>
        </div>
        <form className="reader-page-jump" onSubmit={submitPageJump}>
          <label>
            Sayfa
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              inputMode="numeric"
              aria-label="Sayfa numarası"
            />
          </label>
          <span className="muted">/ {pageCount || "—"}</span>
        </form>
        <div className="row reader-tools">
          <button
            className="btn"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}
            title="Küçült (-)"
          >
            −
          </button>
          <span className="muted">{Math.round(zoom * 100)}%</span>
          <button
            className="btn"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))}
            title="Büyüt (+)"
          >
            +
          </button>
          <button className="btn" disabled={page <= 1} onClick={() => goPage(page - 1)}>
            Önceki
          </button>
          <button
            className="btn"
            disabled={!pageCount || page >= pageCount}
            onClick={() => goPage(page + 1)}
          >
            Sonraki
          </button>
          <button className="btn btn-ghost" onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "Notları gizle" : "Notları göster"}
          </button>
        </div>
      </div>

      <div className="reader-stage" ref={stageRef} onMouseUp={captureSelection}>
        {error && <p className="empty">{error}</p>}
        {loading && !error && <p className="empty">PDF yükleniyor…</p>}
        <div className="pdf-page-wrap" style={{ visibility: loading ? "hidden" : "visible" }}>
          <canvas ref={canvasRef} />
          <div className="pdf-text-layer" ref={textLayerRef} />
        </div>
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
              placeholder="Not / vurgu metni (metin seçerek de doldurulur)"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button className="btn" onClick={() => void addAnnotation("note")}>
              Not ekle
            </button>
            <button
              className="btn"
              onClick={() => void addAnnotation("highlight")}
              disabled={!selection && !noteText.trim()}
            >
              Vurgu
            </button>
            <button className="btn" onClick={() => void addBookmark()}>
              Yer imi
            </button>
          </div>
          <div className="note-list">
            {notes.length === 0 && (
              <p className="muted">Henüz not veya yer imi yok. Metin seçip vurgu ekleyebilirsiniz.</p>
            )}
            {notes.map((n) => (
              <div className="note-item" key={n.id}>
                <button
                  className="btn-ghost note-jump"
                  onClick={() => {
                    try {
                      const loc = JSON.parse(n.locationJson);
                      if (loc.page) goPage(loc.page);
                    } catch {
                      /* ignore */
                    }
                  }}
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
