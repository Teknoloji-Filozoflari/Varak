# Varak paketleme durumu

**Uygulama adı:** Varak  
**Kaynak sürümü:** `0.1.0` (`package.json` / `src-tauri/Cargo.toml` / `tauri.conf.json` ile aynı)

Paketleme bilinçli olarak ertelenmişti; MVP + yedek/istatistik/içe aktarma olgunlaştıktan sonra ele alınır. Bu belge **ne hazır / ne değil** bilgisini net tutar — desteklenmeyen formatları “hazır” diye iddia etmez.

## Hazır olanlar

| Öğe | Durum |
|-----|--------|
| Tauri 2 masaüstü uygulaması (Linux) | Çalışır (`npm run tauri dev` / `npm run tauri build`) |
| Tek kaynak sürümü `0.1.0` | Üç dosyada hizalı |
| Yerel veri modeli + `.varakbak` yedek | Uygulama içi |
| `tauri.conf.json` bundle iskeleti | `bundle.active: true`, ikonlar mevcut |

## Henüz hazır / doğrulanmamış

| Format | Durum | Not |
|--------|--------|-----|
| AppImage | **Hazır değil** | Tauri ile üretilebilir; bu makinede paket CI/imza doğrulanmadı |
| `.deb` | **Hazır değil** | Linux bundle hedefi olarak eklenebilir; repo’da paket tarifi yok |
| Flatpak | **Hazır değil** | Manifest / Flathub gönderimi yok |
| AUR | **Hazır değil** | `PKGBUILD` yok |
| Nix / flake | **Hazır değil** | `flake.nix` yok |
| RPM | **Hazır değil** | Spec yok |
| Windows / macOS paketleri | Kapsam dışı (hedef: Linux masaüstü) | — |

## Önerilen paketleme sırası (sonraki iş)

1. Aynı git etiketinden `npm run tauri build` (sürüm drift’i olmasın).
2. Önce AppImage veya `.deb` (CachyOS/Arch kullanıcıları için AppImage veya AUR ayrı adım).
3. Flatpak ancak runtime + izinler (dosya diyaloğu, ağ metadata) netleşince.
4. Her format için ayrı doğrulama notu; “destekleniyor” iddiası ancak smoke testten sonra.

## Geliştirici komutları

```bash
cd ~/Belgeler/varak
npm install
npm run tauri build
# Çıktı genelde: src-tauri/target/release/bundle/
```

Sistem bağımlılıkları (Arch/CachyOS): `webkit2gtk-4.1`, Rust, Node.js.

## İlkeler

- Paketler **aynı kaynak sürümünden** üretilmeli.
- Yedek formatı (`varak-backup` v1) paket sürümünden bağımsız taşınabilir kalmalı.
- Çevrimiçi metadata isteğe bağlıdır; paketler dosya içeriğini hiçbir servise göndermez.
