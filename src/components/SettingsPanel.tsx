import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettings } from "../types";

interface Props {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onOpenBackup?: () => void;
}

export function SettingsPanel({ settings, onChange, onClose, onOpenBackup }: Props) {
  const [theme, setTheme] = useState(settings.theme);
  const [folder, setFolder] = useState(settings.libraryFolder);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setTheme(settings.theme);
    setFolder(settings.libraryFolder);
  }, [settings]);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setFolder(selected);
  }

  async function save() {
    const next = await api.updateSettings(folder, theme);
    onChange(next);
    setMsg("Ayarlar kaydedildi.");
  }

  return (
    <div className="panel">
      <h2>Ayarlar</h2>
      <div className="form-grid">
        <label>
          Tema
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="system">Sistem</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>
        <label>
          Kitaplık klasörü
          <div className="row">
            <input style={{ flex: 1 }} value={folder} onChange={(e) => setFolder(e.target.value)} />
            <button type="button" className="btn" onClick={pickFolder}>
              Seç
            </button>
          </div>
        </label>
        <p className="muted">
          PDF/EPUB dosyaları buraya kopyalanır; kaynak dosyalarınız olduğu gibi kalır. Metadata ve
          vurgular SQLite içinde tutulur.
        </p>
        {onOpenBackup && (
          <button type="button" className="btn" onClick={onOpenBackup}>
            Yedekleme / dışa aktarma / geri yükleme
          </button>
        )}
        {msg && <p className="muted">{msg}</p>}
        <div className="row">
          <button className="btn btn-primary" onClick={save}>
            Kaydet
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
