import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api } from "../api";
import type { BackupConflict, BackupPreview, RestoreResult } from "../types";

interface Props {
  onDone: () => void;
  onClose: () => void;
}

export function BackupPanel({ onDone, onClose }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [lastRestore, setLastRestore] = useState<RestoreResult | null>(null);

  async function doBackup() {
    const dest = await save({
      defaultPath: `varak-yedek-${new Date().toISOString().slice(0, 10)}.varakbak`,
      filters: [{ name: "Varak yedek", extensions: ["varakbak", "zip"] }],
    });
    if (typeof dest !== "string") return;
    setBusy(true);
    setMsg(null);
    try {
      const manifest = await api.createBackup(dest);
      setMsg(
        `Yedek oluşturuldu: ${manifest.bookCount} kitap, ${manifest.annotationCount} not/vurgu, ${manifest.files.length} dosya.`,
      );
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    const dest = await save({
      defaultPath: `varak-kitaplik-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof dest !== "string") return;
    setBusy(true);
    try {
      await api.exportLibraryJson(dest);
      setMsg("JSON dışa aktarma tamam.");
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    const dest = await save({
      defaultPath: `varak-kitaplik-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (typeof dest !== "string") return;
    setBusy(true);
    try {
      await api.exportLibraryCsv(dest);
      setMsg("CSV dışa aktarma tamam.");
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickRestore() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Varak yedek", extensions: ["varakbak", "zip"] }],
    });
    if (typeof selected !== "string") return;
    setBusy(true);
    setMsg(null);
    setLastRestore(null);
    try {
      const p = await api.inspectBackup(selected);
      setPreview(p);
      const initial: Record<string, string> = {};
      for (const c of p.conflicts) initial[c.incomingId] = "skip";
      setResolutions(initial);
      if (!p.compatible) {
        setMsg(p.compatibilityMessage || "Uyumsuz yedek.");
      } else if (!p.integrityOk) {
        setMsg(`Bütünlük hatası: ${p.integrityErrors.join("; ")}`);
      } else {
        setMsg(
          `Yedek hazır: ${p.manifest.bookCount} kitap · ${p.conflicts.length} çakışma · sürüm ${p.manifest.version}`,
        );
      }
    } catch (err) {
      setPreview(null);
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyRestore() {
    if (!preview) return;
    if (!preview.compatible || !preview.integrityOk) {
      setMsg("Bütünlük/uyumluluk kontrolü geçmeden geri yükleme yapılamaz.");
      return;
    }
    if (mode === "replace") {
      const ok = confirm(
        "Tüm kitaplık yedektekiyle DEĞİŞTİRİLECEK. Devam edilsin mi?",
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await api.restoreBackup(preview.path, {
        mode,
        conflictResolutions: mode === "merge" ? resolutions : null,
      });
      setLastRestore(result);
      setMsg(result.message);
      onDone();
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  function setResolution(c: BackupConflict, value: string) {
    setResolutions((prev) => ({ ...prev, [c.incomingId]: value }));
  }

  return (
    <div className="panel">
      <h2>Yedekleme ve geri yükleme</h2>
      <p className="muted">
        Taşınabilir arşiv kitapları, veritabanını, kapakları, durumları, ilerlemeyi, incelemeleri,
        etiketleri, not/vurgu/yer imlerini ve ayarları içerir. Geri yüklemeden önce bütünlük
        kontrolü yapılır.
      </p>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void doBackup()}>
          Yedek oluştur (.varakbak)
        </button>
        <button className="btn" disabled={busy} onClick={() => void exportJson()}>
          JSON dışa aktar
        </button>
        <button className="btn" disabled={busy} onClick={() => void exportCsv()}>
          CSV dışa aktar
        </button>
        <button className="btn" disabled={busy} onClick={() => void pickRestore()}>
          Yedekten geri yükle…
        </button>
      </div>

      {preview && (
        <div className="form-grid" style={{ marginTop: "0.5rem" }}>
          <p>
            <strong>Manifest:</strong> {preview.manifest.format} v{preview.manifest.version} · app{" "}
            {preview.manifest.appVersion} · {preview.manifest.createdAt.slice(0, 19)}
          </p>
          <p className="muted">İçerik: {preview.manifest.contents.join(", ")}</p>
          <p>
            Bütünlük:{" "}
            {preview.integrityOk ? (
              <span style={{ color: "var(--accent)" }}>Tamam</span>
            ) : (
              <span style={{ color: "var(--danger)" }}>Başarısız</span>
            )}
            {" · "}
            Uyumluluk:{" "}
            {preview.compatible ? (
              <span style={{ color: "var(--accent)" }}>Uygun</span>
            ) : (
              <span style={{ color: "var(--danger)" }}>Uyumsuz</span>
            )}
          </p>

          <label>
            Geri yükleme modu
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "replace" | "merge")}
            >
              <option value="merge">Birleştir (çakışmaları sor)</option>
              <option value="replace">Tümünü değiştir</option>
            </select>
          </label>

          {mode === "merge" && preview.conflicts.length > 0 && (
            <div>
              <h3 style={{ margin: "0.4rem 0", fontFamily: "var(--font-display)" }}>
                Çakışmalar ({preview.conflicts.length})
              </h3>
              <div className="meta-results">
                {preview.conflicts.map((c) => (
                  <div key={c.incomingId} className="meta-item" style={{ display: "block" }}>
                    <div>
                      <strong>{c.incomingTitle}</strong>
                      <div className="muted">
                        {c.reason}
                        {c.existingTitle ? ` · yerelde: ${c.existingTitle}` : ""}
                      </div>
                    </div>
                    <select
                      className="reader-select"
                      style={{ marginTop: "0.4rem" }}
                      value={resolutions[c.incomingId] || "skip"}
                      onChange={(e) => setResolution(c, e.target.value)}
                    >
                      <option value="skip">Atla (yereli koru)</option>
                      <option value="keep_local">Yereli koru</option>
                      <option value="take_incoming">Yedektekiyle değiştir</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="row">
            <button
              className="btn btn-primary"
              disabled={busy || !preview.compatible || !preview.integrityOk}
              onClick={() => void applyRestore()}
            >
              Geri yüklemeyi uygula
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPreview(null);
                setLastRestore(null);
              }}
            >
              Önizlemeyi kapat
            </button>
          </div>
        </div>
      )}

      {lastRestore && <p className="muted">{lastRestore.message}</p>}
      {msg && <p className="muted">{msg}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  );
}
