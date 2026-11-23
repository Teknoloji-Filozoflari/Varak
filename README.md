# Varak

Yerel öncelikli Linux masaüstü kitaplık ve okuma uygulaması.

**Yığın:** Tauri 2 · React · TypeScript · SQLite

## Özellikler

- Raflar: Okunacak, Okuyorum, Okudum, Yarım bıraktım
- Fiziksel kitap ekleme; PDF/EPUB içe aktarma (önizleme, yinelenen uyarı; kaynak dosyaya dokunulmaz)
- EPUB kapak çıkarma; PDF/EPUB okuyucular (yakınlaştırma / yazı / tema, not–vurgu)
- Arama / filtre, etiketler, puan, inceleme, ilerleme ve tarihler
- Yedek `.varakbak` (manifest + SHA-256), JSON/CSV dışa aktarma, değiştir/birleştir geri yükleme
- İstatistikler (okunan kitap/sayfa, aylık–yıllık)
- SQLite metadata; yapılandırılabilir kitaplık klasörü
- Türkçe arayüz; açık/koyu tema
- Soft-fail Open Library + Google Books (yalnızca ISBN/başlık/yazar; dosya içeriği gönderilmez)

## Geliştirme

```bash
cd ~/Belgeler/varak
npm install
npm run tauri dev
```

Gereksinimler: Node.js, Rust, `webkit2gtk-4.1` (Arch/CachyOS’ta genelde yüklü).

Veri: `~/.local/share/varak/` (`varak.db` + `library/`).

## Paketleme

Durum ve doğrulanmamış formatlar: [docs/packaging.md](docs/packaging.md).
