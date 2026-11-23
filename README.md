# Varak

Yerel öncelikli Linux masaüstü kitaplık ve okuma uygulaması.

**Yığın:** Tauri 2 · React · TypeScript · SQLite

## Özellikler (MVP)

- Raflar: Okunacak, Okuyorum, Okudum, Yarım bıraktım
- Fiziksel kitap ekleme; PDF/EPUB içe aktarma (kaynak dosyaya dokunulmaz)
- Arama / filtre, etiketler, puan, inceleme, ilerleme ve tarihler
- PDF (pdf.js) ve EPUB (epub.js) okuyucular; konum kalıcı
- Vurgu / not / yer imi — kaynak dosya değiştirilmez
- SQLite metadata; yapılandırılabilir kitaplık klasörü
- Türkçe arayüz; açık/koyu tema
- Open Library + Google Books metadata (çevrimdışıda yumuşak hata)

## Geliştirme

```bash
cd ~/Belgeler/varak
npm install
npm run tauri dev
```

Gereksinimler: Node.js, Rust, `webkit2gtk-4.1` (Arch/CachyOS’ta genelde yüklü).

Veri: `~/.local/share/varak/` (`varak.db` + `library/`).

## Paketleme

deb / AUR / Nix / AppImage / Flatpak / RPM — ertelendi; önce çalışan MVP.
