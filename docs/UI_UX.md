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


## V2 operator changes

Edit Channel saves a draft and requires a change summary in the UI. Revisions in the channel menu opens authenticated history, sanitized configuration review, chronological compare, publish and rollback. A summary is required for activation; stale expected revision returns an actionable conflict. Source settings expose Optional/Required/Disabled idempotency and per-channel profile JSON. Review includes synthetic validation/dry-run; it never sends a network payload.

Message details display accepted revision and idempotency indicator. Payload defaults to redacted; ADMIN raw toggle is audited and copy uses visible content. OUT dead-letter detail offers state/category/reason reconciliation; transport resend still has its separate confirmation. Settings lists/revokes own browser sessions and ADMIN acknowledges persistent operational alerts. Deployment-owned secret/TLS/masking/alert configuration is not exposed through dummy controls.

Existing dialog focus trapping, Escape handling, focus restore, labels and screen-reader statuses are retained. Browser tests cover role visibility, unsaved edits, comparison/publish, mobile layout and text-safe payload/resend. A full automated accessibility audit and every new workflow's keyboard/mobile matrix remain NOT TESTED.


### Development follow-up: revision operations and diagnostics

Open Revisions, review the sanitized configuration, then choose Edit draft. Name/idempotency and destination name/enabled/timeout edits create an immutable successor; add a change summary before saving. Credentials, scripts and circuit policy omitted from that form are retained server-side. A stale draft shows a conflict and keeps the editor open; discard confirmation protects unsaved edits. Test the stored revision using synthetic data; previews are masked and no network is performed. Review configuration exposes an explicit destination connection test (DNS plus TCP/TLS only, without HTTP/MLLP patient payload). Publish/rollback use the existing activation guard.

The destination editor accepts optional circuit failure threshold/open duration/concurrency. Empty fields inherit deployment defaults. Changes remain drafts until publish. An open circuit can be reset from the destination summary after recovery confirmation; the backend refuses reset during active delivery and audits a fixed reason. Settings for ADMIN show effective deployment configuration and allow an audited aggregate metadata download. Deployment settings are read-only. Role changes refresh on token renewal, focus/visibility and a visible one-minute interval; backend permissions remain authoritative. Axe checks login/channel/revision surfaces and keyboard focus; full product/manual accessibility testing remains required.

## Simplifikasi usability — 16 Oktober 2026

### Membuat koneksi sederhana

1. Pilih **Channels → New Channel**, isi nama, pilih **HTTP receiver** dan **JSON**. Channel baru memakai JSON; konfigurasi channel lama dipertahankan.
2. Buka **Advanced source settings** hanya jika perlu. **Message validation** default **No additional validation**; **Basic JSON validation** membatasi pesan menjadi object JSON; **Custom validation schema** membuka editor profil backend, termasuk JSON Schema, aturan XML/HL7 dan script yang sudah didukung. **Duplicate message protection** default **Optional** dan tetap menggunakan header `Idempotency-Key`.
3. Pada **Processing**, biarkan **No source transformation · Pass-through** bila struktur pesan tidak perlu berubah. **Advanced processing** menyimpan filter dan custom response. Filter nonaktif menerima semua pesan. `return true` menerima pesan; `return false` memfilter pesan. Script tetap dapat digunakan developer.
4. Pada **Destinations**, isi nama, connector, outbound format dan endpoint. Untuk JSON → XML, pilih **XML** tanpa menambahkan transformer jika konversi standar sudah cukup. **Test connection** memeriksa DNS dan TCP/TLS dengan validasi tujuan yang sama seperti transport. Pemeriksaan ini tidak mengirim request HTTP, MLLP, atau patient payload dan tidak membuktikan aplikasi penerima menerima data.
5. **Advanced destination settings** membagi **Message processing**, **Delivery settings**, dan **Response processing**. Timeout ditampilkan dalam detik; backend tetap menyimpan milidetik. Field retry hanya terbuka ketika **Automatic retry** aktif. Batas circuit/concurrency tetap tersedia. Maximum delay belum menjadi pengaturan backend sehingga tidak ditampilkan sebagai kontrol baru.
6. Pada **Review**, periksa ringkasan dan pilih **Preview output** untuk pesan sintetis. Preview menampilkan input, validasi/filter/transformation source, hasil per destination dan **Network delivery: NOT_SENT**. Tidak ada DNS lookup atau pengiriman destination dalam dry-run. Hasil preview dihapus ketika input/konfigurasi berubah. Payload preview tetap dimask; ADMIN dapat memilih **View raw synthetic preview (audited)**. Akses tersebut tercatat di audit. XML/text dimask seluruhnya pada tampilan biasa; gunakan raw berizin untuk memeriksa isi XML sintetis.
7. **Save Channel** membuat channel Stopped dan memakai ringkasan otomatis **Initial channel configuration**. Edit channel existing tetap membutuhkan **Change summary**; edit membuat draft yang perlu di-review/publish melalui **Revisions** sebelum runtime berubah. Riwayat dan rollback tetap tersedia.

### Setelah Save

Dialog **Channel saved** menyediakan **Create API key → Start channel → Send synthetic message → Open Messages**. Key hanya muncul sekali di dialog, dapat disalin, dan hilang ketika dialog ditutup. Rotate segera membatalkan key sebelumnya. Contoh curl/Postman memakai placeholder, bukan key asli. Ganti key dan request ID unik sebelum memakai contoh tersebut.

**Current source endpoint** berasal dari konfigurasi backend. Set `PUBLIC_BASE_URL=http://localhost:9000` pada development atau `PUBLIC_BASE_URL=https://connect.bulmar.tech` pada server HTTPS, lalu restart backend. `INBOUND_BASE_URL` lama masih menjadi fallback bila nilai baru tidak diset. `INBOUND_PATH` existing tetap dihormati. Copy endpoint, curl dan Postman tersedia di editor, detail channel dan onboarding. Clipboard browser membutuhkan HTTPS atau secure localhost; bila browser menolak, endpoint/key tetap dapat disalin manual.

**Send synthetic message** di onboarding berbeda dari dry-run: setelah channel Running dan key dibuat, pengguna harus mengonfirmasi **Send test request** karena pesan benar-benar diteruskan ke destination aktif. Respons inbound hanya memastikan request diterima; buka Messages untuk memastikan status setiap destination. Jika key sudah disimpan dan dialog ditutup, kirim lewat Postman/curl tanpa perlu merotasi key.

### Membaca hasil di Messages

Pada **Payload**, lihat **Original inbound payload** (pesan yang diterima), **Source processed payload** (hasil source sebelum pemrosesan destination), lalu **Outbound deliveries**. Setiap destination menampilkan format output, alur pemrosesan, payload outbound tersimpan, delivery status dan response. **No source transformation** hanya muncul bila revision snapshot membuktikan tidak ada transformer source; legacy data tidak ditebak menggunakan konfigurasi channel saat ini. Format dan connector outbound juga berasal dari snapshot penerimaan pesan.

Payload pada attempt Delivered adalah hasil akhir yang diterima destination. Attempt yang gagal pada persiapan dapat menyimpan input persiapan, sehingga UI mengingatkan pengguna untuk memeriksa status dan history. Retry tampil sebagai attempt terpisah; pagination pada Payload dan Delivery history tetap tersedia. Message direction OUT menampilkan **Stored outbound payload** agar tidak salah dilabeli sebagai inbound.

Redacted tetap default. **View raw (audited)** hanya untuk permission khusus dan memiliki peringatan sebelum tindakan. Copy mengikuti isi yang sedang ditampilkan. Tooltip status menjelaskan arti Delivered, Filtered, Retry scheduled dan Dead letter; unknown delivery outcome tetap perlu rekonsiliasi sebelum resend.
