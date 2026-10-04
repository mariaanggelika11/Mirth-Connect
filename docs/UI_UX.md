# UI / UX refresh — 4 Oktober 2026

Perubahan mengikuti navigasi **Overview / Channels / Messages / Settings** pada framework React/Vite existing. Sidebar desktop berubah menjadi navigasi empat menu pada mobile. Halaman awal login baru adalah Overview; hash routes mendukung tautan dari overview ke channel/message yang dipilih dan tombol Back browser.

## Alur utama

- **Overview:** koneksi database, channel aktif, received today sesuai midnight zona waktu browser, error dan waiting for retry, daftar masalah serta channel activity. Angka dan status berasal dari backend; tidak ada chart atau traffic contoh pada aplikasi. Refresh manual dan polling overview 30 detik; polling diabaikan saat tab tidak terlihat.
- **Channels:** search/status filter, source → destinations, traffic/error, start/stop langsung, detail expandable, menu edit/duplicate/export/delete. Delete channel running dinonaktifkan. Duplicate membuat draft baru tanpa ID atau credential sumber. XML export memakai format import Mini Mirth, tanpa runtime IDs dan tanpa credential endpoint yang dimask oleh backend.
- **Editor:** Source → Processing → Destinations → Review. Transformer/filter/response/template, seluruh connector types, retry, timeout, enabled state dan source key tetap tersedia. Setting lanjutan tersembunyi hingga dibuka. Continue tidak menyimpan; Save eksplisit setelah review. Close/backdrop/Escape meminta discard confirmation jika draft berubah. Source key rotation dijelaskan sebagai aksi langsung dan memerlukan konfirmasi.
- **Messages:** filter channel/direction/status/date, search debounce, grouping error dan pending retry, pagination server. Detail terbuka sebagai drawer dengan Summary / Payload / Delivery history. Menutup drawer mempertahankan filter/page. Payload hanya tersedia untuk role berizin, mendukung Pretty/Raw/HL7 Tree, pencarian dan copy. Konten dirender sebagai text, bukan HTML.
- **Resend:** eligibility berasal dari status outbound terkini, snapshot tersimpan dan channel running; UI juga memeriksa permission. Pengguna meninjau payload/destination terlebih dahulu dan menekan Confirm resend. Backend tetap memvalidasi ulang saat aksi dijalankan.
- **Settings:** account/connection untuk semua role; admin mendapatkan user list, create user, role change confirmation dan paginated audit log. Semua aksi tersambung ke API existing. Password/database secret tidak muncul pada settings.

## Desain dan aksesibilitas

Warna aksen biru, panel putih, latar abu-abu muda, border ringan dan typography konsisten. Status memakai warna serta teks. Tabel dapat digeser di dalam container pada mobile tanpa overflow seluruh halaman. Empty/loading/error states tampil di setiap area; error konfirmasi tampil pada dialog yang aktif.

Navigasi memakai accessible labels/current state, skip-to-content, visible focus dan reduced-motion support. Modal/drawer menjaga focus, menangani Escape pada dialog teratas dan mengembalikan focus setelah ditutup. Tombol konfirmasi dinonaktifkan selama request untuk mencegah submit berulang.

## Backend pendukung

`GET /api/message/stats?dateFrom=<ISO>` menambah `messagesToday`, `queuedMessages` dan `deadLetterMessages`; bidang stats lama tetap ada. `GET /api/message` menambah `direction=ALL` serta `statusGroup=errors|pending`. Detail/log metadata menambah eligibility resend serta retry/correlation/error metadata. Tidak ada schema migration baru untuk UI ini.

`errors` mencakup IN-ERROR / OUT-ERROR / DEAD_LETTER; `pending` mencakup QUEUED / RETRYING. Karena itu tautan dari angka Overview memakai grup yang sesuai, bukan hanya satu status.

## Verifikasi

131 test otomatis, 12 test Chrome browser dan 6 skenario PostgreSQL terisolasi lulus. Typecheck, lint dan production build lulus. Browser test menggunakan data synthetic, mencakup permission tiap role, navigation/mobile, pagination/drawer, session expiry, wizard tanpa auto-save, discard confirmation, settings/admin, payload text safety, confirm resend, duplicate dan XML download. XML export juga diuji round trip melalui parser import backend.

PostgreSQL tests menggunakan schema sementara `mirth_test_*` yang dibuat dan dihapus runner. Test mencakup stats/date boundary, group filters, log detail, auth/channel/delivery/logout, rollback, dedupe/concurrent retry, migration ulang dan retention. Tidak ada perubahan channel/pesan existing untuk test UI ini. Profil HL7 rumah sakit, container, load/HA dan disaster recovery tetap memerlukan qualification terpisah.

Buka hasil build di `http://localhost:9000`, atau development frontend di `http://localhost:5173`. Setelah build baru, reload browser dengan Cmd+Shift+R jika halaman lama masih tersimpan.
