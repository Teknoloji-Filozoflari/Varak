import { useEffect, useState } from "react";
import { api } from "../api";
import type { LibraryStats } from "../types";

interface Props {
  onClose: () => void;
}

export function StatsPanel({ onClose }: Props) {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setStats(await api.getStatistics());
      } catch (err) {
        setError(String(err));
      }
    })();
  }, []);

  return (
    <div className="panel">
      <h2>İstatistikler</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {!stats && !error && <p className="muted">Hesaplanıyor…</p>}
      {stats && (
        <div className="form-grid">
          <div className="stats-grid">
            <StatCard label="Toplam kitap" value={stats.totalBooks} />
            <StatCard label="Okunan" value={stats.readBooks} />
            <StatCard label="Okunuyor" value={stats.readingBooks} />
            <StatCard label="Okunacak" value={stats.toReadBooks} />
            <StatCard label="Yarım bırakılan" value={stats.abandonedBooks} />
            <StatCard label="Okunan sayfa (yaklaşık)" value={stats.pagesRead} />
            <StatCard label="Vurgu" value={stats.highlights} />
            <StatCard label="Not" value={stats.notes} />
            <StatCard label="Yer imi" value={stats.bookmarks} />
          </div>

          <h3 style={{ margin: "0.6rem 0 0.3rem", fontFamily: "var(--font-display)" }}>
            Aylık özet (biten kitaplar)
          </h3>
          {stats.monthly.length === 0 ? (
            <p className="muted">Henüz bitiş tarihi olan kitap yok.</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Ay</th>
                  <th>Kitap</th>
                  <th>Sayfa</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthly.map((m) => (
                  <tr key={m.period}>
                    <td>{m.period}</td>
                    <td>{m.booksFinished}</td>
                    <td>{m.pagesRead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ margin: "0.8rem 0 0.3rem", fontFamily: "var(--font-display)" }}>
            Yıllık özet
          </h3>
          {stats.yearly.length === 0 ? (
            <p className="muted">Henüz yıllık veri yok.</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Yıl</th>
                  <th>Kitap</th>
                  <th>Sayfa</th>
                </tr>
              </thead>
              <tbody>
                {stats.yearly.map((y) => (
                  <tr key={y.period}>
                    <td>{y.period}</td>
                    <td>{y.booksFinished}</td>
                    <td>{y.pagesRead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
