# Mini Mirth Connect

Integration engine untuk HTTP, HL7 v2/MLLP, JSON, XML dan text, dengan UI channel/monitor existing. React/Vite → Express/TypeScript → PostgreSQL → filter/transformer → destination. Refactor ini meningkatkan keamanan dan keandalan; penerimaan sistem rumah sakit tetap diperlukan sebelum produksi.

## Requirements dan struktur

Node.js **22.18+**, npm, PostgreSQL 14+ dengan database yang sudah dibuat. Chrome lokal untuk uji browser; Docker opsional.

- `client/src`: UI React, auth/session, channel editor, monitor.
- `server/src/config`: konfigurasi tervalidasi dan connection pool.
- `server/src/middleware`: JWT, RBAC, error handler.
- `server/src/services`: channel, engine, worker, HL7, script sandbox dan audit.
- `server/src/utils`: framing, parser, transport, enkripsi, validation.
- `server/migrations`: schema/index versioned.
- `server/test`, `client/test`, `client/e2e`: test otomatis.
- `docs/ARCHITECTURE.md`, `docs/AUDIT.md`, `docs/AUDIT_REPORT.md`: desain dan hasil audit.

## Installation dan environment

```sh
npm install
cp .env.example .env
cp client/.env.example client/.env
```

Jika `.env` lokal sudah ada, gabungkan variable dari example tanpa menimpa kredensial yang masih diperlukan. Hanya **root `.env`** yang dibaca backend, terlepas dari working directory. `server/.env` lama tidak dipakai. Environment dari process/container memiliki prioritas.

Isi `DATABASE_URL`, `JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`. JWT secret minimal 32 karakter; encryption key tepat 64 karakter hex. Generate **dua nilai independen** dengan `openssl rand -hex 32` dan simpan di secret manager/.env lokal. Jangan commit nilainya. `JWT_EXPIRES_IN` sekarang berupa **detik**, misalnya `3600`; ganti nilai lama seperti `1d`.

Konfigurasi TLS/schema memakai `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED`, dan `PG_SCHEMA`. Override `sslmode`/TLS/`options` dalam URL ditolak agar tidak melewati validasi production. Password dalam URL harus URL-encoded.

`INBOUND_API_KEY` opsional: fallback development saja, minimal 32 karakter bila diisi. Production wajib memakai key per-channel. Nilai kosong menonaktifkan fallback.

Konfigurasi penting:

| Variable | Perilaku |
| --- | --- |
| `HOST`, `PORT` | Default `127.0.0.1`, `9000` |
| `CORS_ORIGINS` | Origin HTTP(S) eksplisit, comma separated; wildcard ditolak |
| `DATABASE_URL` | URL PostgreSQL lengkap, password URL-encoded; contoh `postgresql://USER:PASSWORD@HOST:5432/MiniMirthDev` |
| `PG_SCHEMA` | Default `public`; schema test memakai nama unik `mirth_test_*` |
| `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED` | Default `false`, `true`; production mewajibkan keduanya `true` |
| `HL7_ENABLED`, `HL7_HOST`, `HL7_PORT` | Default `true`, `127.0.0.1`, `2575` |
| `HL7_ALLOWED_IPS` | IP literal peer yang diperbolehkan; default loopback |
| `INBOUND_BASE_URL`, `INBOUND_PATH` | URL yang ditampilkan untuk HTTP source; default `/api/inbound` |
| `OUTBOUND_ALLOWED_HOSTS` | Hostname/IP destination yang diizinkan; wajib di production |
| `REQUEST_TIMEOUT_MS`, `PAYLOAD_LIMIT_BYTES` | Default 10 detik, 1 MiB |
| `SCRIPT_TIMEOUT_MS`, `SCRIPT_MEMORY_MB`, `SCRIPT_CONCURRENCY` | Default 1000 ms, 16 MiB, 4 worker aktif |
| `MESSAGE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS` | Default 30 dan 365 hari |
| `PUBLIC_REGISTRATION` | Default false; bila diaktifkan hanya VIEWER |

`BASE_URL`/`INBOUND_BASE` lama diganti `INBOUND_BASE_URL`/`INBOUND_PATH`. Endpoint legacy `/api/message/inbound/:channelId` tetap tersedia dengan JWT dan permission `inbound:send`. `VITE_API_BASE_URL` kosong memakai same origin; `VITE_API_PROXY_URL` menentukan backend development. Jangan masukkan secret dalam variable `VITE_`.

## Database setup dan migration

Buat database kosong melalui PostgreSQL administrator, misalnya:

```sql
CREATE DATABASE "MiniMirthDev";
```

Set `.env` untuk database tersebut, lalu:

```sh
npm run db:migrate
npm run bootstrap:admin
```

Migration `001_engine.sql` membuat tabel yang belum ada, menambah field engine, audit/revocation, index pagination/retry/deduplikasi, dan menormalkan role. Migrator mengenkripsi endpoint connector lama. Jalankan dahulu di salinan database; duplikasi username/constraint/schema custom harus direkonsiliasi, bukan dihapus otomatis. Script memakai satu client PostgreSQL, transaction dan advisory lock. Nama tabel mixed-case (`"Users"`, `"Channels"`) dipertahankan untuk kompatibilitas dengan database existing. Migration tidak memindahkan data dari SQL Server; target PostgreSQL existing dipakai langsung.

`bootstrap:admin` meminta username, nama, dan password tersembunyi (minimal 12 karakter). Tidak memakai admin/password default. Gunakan account migration dengan izin DDL, lalu account runtime dengan hak minimum yang diperlukan. Aplikasi tidak menjalankan migration secara otomatis.

## Run development / production

Development, dua terminal:

```sh
npm run dev
```

```sh
npm run dev:client
```

Frontend development: `http://localhost:5173`; hasil build web juga tersedia langsung di `http://localhost:9000`. Default CORS mengizinkan kedua port tersebut pada `localhost` dan `127.0.0.1`. Proxy development melayani `/api`, `/health`, `/ready`. Backend juga melayani hasil build UI.

Production setelah environment/migration sesuai:

```sh
npm run typecheck
npm run lint
npm test
npm run build
NODE_ENV=production npm start
```

Set `HOST`, CORS, hostname outbound, verified PostgreSQL TLS dan source key sebelum exposure. Gunakan HTTPS reverse proxy untuk UI/API dan jaringan terisolasi atau TLS tunnel untuk MLLP. Aplikasi tidak menyediakan TLS MLLP native.

## Authentication dan RBAC

Bearer JWT HS256: expiry, issuer, audience, `jti`; role dibaca ulang dari database per request. Logout yang berhasil mencabut token di SQL. UI menghapus session pada seluruh 401/token invalid dan saat expiry. Token masih disimpan di localStorage; CSP dan tidak adanya script CDN mengurangi risiko, tetapi tidak menghilangkan risiko XSS.

| Role | Izin |
| --- | --- |
| ADMIN | Semua izin, user/role/audit, channel, payload dan resend |
| DEVELOPER | Membuat/mengedit channel/script, start/stop, metadata/payload, inbound JWT |
| OPERATOR | Monitor, start/stop, payload dan resend; tidak mengedit/delete |
| VIEWER | Metadata channel/message saja; tidak melihat payload atau script configuration |

Admin API: `GET/POST /api/users`, `PUT /api/users/:id/role`; tidak mengembalikan password/hash. Perubahan role diaudit dan administrator terakhir tidak bisa diturunkan role. Registration menolak property role dari caller.

## Channel flow dan HTTP integration

Create channel → status STOPPED → configure source/destination/filter/transformer → start RUNNING. Status PAUSED/STOPPED/ERROR menolak receive baru; work yang sudah diterima diselesaikan. Destination berurutan mengikuti ID existing. Destination yang dihapus dari form di-retire, sehingga log historis tetap ada. Channel dengan retained messages tidak dapat dihapus; gunakan stop dan retention.

Untuk source HTTP, buka Edit Channel → **Create / rotate source API key**. Key ditampilkan sekali pada aksi ini, disimpan AES-256-GCM dan tidak dikembalikan oleh list channel. Rotasi langsung membatalkan key sebelumnya.

```sh
curl -X POST http://localhost:9000/api/inbound/1 \
  -H "X-API-Key: $CONNECTOR_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"sample":"synthetic integration test"}'
```

Set `CONNECTOR_KEY` di terminal dari hasil rotasi, bukan dari source. Production API harus diakses lewat HTTPS. HTTP success 200 berarti delivery selesai; 202 berarti sudah tercatat durably dan retry dijadwalkan. Error memiliki `success`, `code`, `message`, `requestId`. Route success legacy seperti login/list channel mempertahankan format agar kompatibel.

REST destination mempunyai timeout dan limit response, tanpa redirect/proxy environment. Hanya 2xx sukses. Header correlation dan `Idempotency-Key` stabil membantu deduplikasi downstream; destination tetap harus menerapkannya. Credential URL/query dienkripsi; list mengembalikan URL yang dimask dan `credentialConfigured`. Perubahan URL yang menyimpan credential meminta re-entry, agar credential tidak hilang tanpa diketahui.

## HL7 / MLLP integration

JSON → HL7: pilih HTTP source dengan inbound JSON dan destination dengan outbound HL7V2. Objek harus berisi satu `MSH` dengan field `9`, `10`, `11`, `12`; `MSH.1` dan `MSH.2` default ke `|` dan `^~\&`. Converter menempatkan MSH pertama, mempertahankan urutan segmen lain, dan menolak struktur yang tidak valid sebelum delivery. Ini validasi dasar, bukan validasi profil rumah sakit.

Nilai string dianggap teks: `A|B` menjadi `A\F\B`; kontrol/baris baru menjadi escape hex sehingga tidak membuat segmen tambahan. Komponen gunakan objek numerik (contoh `"9": {"1": "ADT", "2": "A01"}`), repetisi gunakan array. String `"ADT^A01"` bukan pengganti objek komponen. Escape HL7 yang sudah valid dipertahankan untuk round trip; untuk teks literal `\F\`, gunakan `\E\F\E\`. JSON bisnis seperti `{"nama":"Budi"}` tetap perlu transformer untuk memetakan field ke segmen.

Source HL7 menggunakan listener bersama dan IP allowlist. Filter routing menerima object `msg` hasil parser. Tepat satu channel RUNNING harus cocok; tanpa filter berarti channel tersebut menerima semua. Dua channel cocok menghasilkan AR untuk mencegah duplikasi tak disengaja.

Pesan contoh, separator sebenarnya `CR` (`\r`):

```text
MSH|^~\&|HIS|HOSP|LIS|LAB|20261004120000||ORU^R01|EXAMPLE-001|P|2.5
PID|1||EXAMPLE-MR||TEST^PATIENT
OBX|1|ST|EXAMPLE||SYNTHETIC
```

Parser mendukung CR/CRLF/LF, delimiter MSH, MSH-1/MSH-2 special numbering, repeated segment/field, component/subcomponent, dan preserved escape sequences. `decodeEscapes` tersedia sebagai utility eksplisit. Segmen berulang berupa array; field repetition berupa array. Single component tetap dapat diakses dengan `msg.PID['5']['2']`.

Framing: `0x0B + message + 0x1C + 0x0D`. Fragmentasi/multiple frames diproses berurutan. ACK menukar sender/receiver, mempertahankan processing/version/trigger dan MSA control ID, memakai UTC HL7 timestamp. AA hanya untuk hasil sukses/accepted queue yang sudah persisten; AE untuk processing failure; AR untuk invalid HL7/tidak ada routing/ambiguity. Outbound MLLP memeriksa framed ACK, MSA code dan control ID tanpa menunggu peer menutup socket.

Deduplikasi inbound HL7 memakai channel + sending application/facility + MSH-10 selama message masih retained. Pesan yang sama tidak dikirim ulang oleh receive; bila gagal, gunakan resend outbound terkontrol. JSON HTTP belum mempunyai idempotency inbound otomatis.

## Transformer / filter

Script berjalan di QuickJS WebAssembly dalam worker terpisah, dengan input/output JSON saja. `process`, `require`, filesystem, database, network dan environment host tidak tersedia. Timeout, memory limit, worker heap limit, output limit dan concurrency cap aktif. Helpers `hl7ToJson`/`jsonToHl7` berjalan di interpreter tersebut, bukan sebagai callback dengan object host.

Transformer/template harus mengembalikan JSON/string yang valid; filter mengembalikan boolean; response script mengembalikan response. Script async/network tidak didukung. Tinjau script existing terhadap perubahan parser MSH dan repeated fields.

## Retry, monitoring dan retention

Outbound dicatat sebelum send, beserta payload final dan snapshot connector terenkripsi. Retry exponential mempunyai `retry_count`, `next_retry_at`, lease dan diagnostic error code; worker mengambil due work dari SQL tanpa sleep yang memblokir request. Retry memakai snapshot dan final payload, tidak menjalankan transformer/template ulang. Maksimum retry menghasilkan DEAD_LETTER. Manual resend memerlukan OPERATOR/ADMIN dan running channel.

Crash setelah network send bisa membuat hasil delivery ambigu. Lease yang expired ditandai `DELIVERY_OUTCOME_UNKNOWN`/DEAD_LETTER dan perlu rekonsiliasi operator; tidak dikirim ulang otomatis. Ini bukan jaminan exactly-once lintas sistem.

Monitor: `GET /api/message?page=1&pageSize=50&channelId=1&direction=IN&status=SUCCESS&search=example&dateFrom=2026-10-01T00:00:00Z`. Maksimum pageSize 100; payload tidak masuk list. Detail `/api/message/:id?logPage=1` menampilkan lima destination results per page dengan permission payload. Retry history dapat ditelusuri per page. `GET /api/audit?page=1` khusus ADMIN.

Maintenance menghapus batch pesan SUCCESS/FILTERED/RECEIVED yang melewati retention dan tidak mempunyai outstanding/failed child. Unresolved errors/dead letters tidak dipurge otomatis; harus direkonsiliasi. Audit memakai retention terpisah. Atur retention sesuai kebijakan organisasi dan regulasi yang berlaku, serta sediakan backup/restore teruji.

## Testing dan build

```sh
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:e2e
```

Browser test default menggunakan Google Chrome macOS. Linux/Windows: set `CHROME_PATH` ke executable Chrome yang tersedia. Test browser menggunakan fixture synthetic dan tidak membaca database rumah sakit. Unit/integration API menggunakan SQL driver mock; transport/listener memakai loopback sungguhan.

Uji PostgreSQL **sungguhan**, pada schema sementara yang terisolasi:

```sh
PG_SCHEMA=mirth_test_$(date +%s) LOG_LEVEL=silent npm run test:sql
```

Script menolak schema `public`, membuat schema baru, menjalankan migration dan enam skenario synthetic, lalu menghapus schema tersebut. Pengguna DB memerlukan izin CREATE schema. Login/channel/transport/monitor/logout, rollback, concurrent retry/dedupe, idempotent migration dan retention sudah diuji pada PostgreSQL nyata. Tabel `public` tidak dipakai oleh test ini.

Local receiver harness (synthetic data saja):

```sh
npm run build
node server/dummy-receiver2.js
# terminal lain
node server/dummy-hl7-receiver.js
node server/send-hl7.js /path/to/synthetic-message.hl7
```

## Docker (opsional)

Dockerfile membangun monolith existing, menjalankan Node non-root dan memisahkan build/runtime. Tidak ada secret yang di-copy ke image.

```sh
docker compose build
# DATABASE_URL dapat memakai host.docker.internal untuk PostgreSQL development pada host.
docker compose run --rm engine node server/dist/scripts/migrate.js
docker compose run --rm engine node server/dist/scripts/bootstrap.js
docker compose up -d
```

Compose ini development, DB eksternal, port host loopback. Container/migration belum diverifikasi dengan Docker di workspace ini. Untuk production, supply secret manager environment, TLS ingress, peer IP allowlist, resource limits, persistent PostgreSQL backups dan monitoring.

## Security notes dan troubleshooting

- `.env` sudah tidak tracked, tetapi secret lama masih ada dalam Git history. Rotate SQL/JWT/connector credentials yang pernah tersimpan, review user ADMIN lama, lalu lakukan history cleanup bersama pemilik repository.
- Jangan mengubah encryption key tanpa re-enkripsi endpoint/source keys/snapshot dengan key lama. Simpan recovery key di secret manager terpisah.
- Startup `Invalid environment`: lengkapi mandatory keys; expiry JWT harus detik, bukan `1d`.
- `STARTUP_FAILED`: periksa DB, migration dan port; credential/internal SQL tidak dicetak.
- `TOKEN_INVALID`: login lagi setelah deployment/rotasi; token lama tidak memenuhi issuer/audience/jti.
- `CONNECTOR_UNAUTHORIZED`: buat/rotate key per-channel; JWT bukan credential source external.
- `DESTINATION_HOST_DENIED`: tambahkan hostname exact ke allowlist yang ditinjau administrator. DNS resolution dipin dan alamat link-local/metadata diblokir.
- MLLP AR: periksa MSH required fields, allowlist peer, channel RUNNING dan tepat satu filter cocok.
- `/health` liveness; `/ready` memeriksa database. SIGTERM/SIGINT menutup HTTP/MLLP, menunggu active work/worker dan menutup pool; deadline shutdown configurable.

## Migrasi PostgreSQL pada database existing

Konfigurasi backend sekarang memakai `DATABASE_URL`, bukan `SQL_*`. URL lokal ditujukan ke **MiniMirthDev**, bukan database lain pada server yang sama. `server/.env` tidak dibaca. Gunakan `PG_SSL=true` dengan verifikasi sertifikat untuk production; konfigurasi development lokal mengikuti koneksi PostgreSQL yang diberikan.

Migrasi 4 Oktober 2026 mempertahankan tabel dan ID existing, menambahkan tabel engine/audit/revocation/index, serta mempertahankan timestamp lama tanpa konversi otomatis. Detail penerapan dan hasil pemeriksaan ada di [laporan PostgreSQL](docs/POSTGRES_MIGRATION.md). Tidak ada username/password default atau credential database dalam source.

## UI / UX workspace

Navigasi sekarang memakai Overview, Channels, Messages dan Settings. Editor channel mengikuti empat langkah dengan advanced settings; detail message memakai drawer dan resend memerlukan review. Admin dapat mengelola pengguna dan melihat audit dari Settings. Detail fitur dan verifikasi: [UI / UX](docs/UI_UX.md).


## Production hardening V2 (14 October 2026)

Laporan terbaru: [IMPLEMENTATION_REPORT_V2](docs/IMPLEMENTATION_REPORT_V2.md), [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md), [gap analysis](docs/GAP_ANALYSIS_2026.md). Aplikasi belum dinyatakan production-ready. Branch ini tidak mengakses atau mengubah database production.

Sebelum upgrade: backup terenkripsi teruji, review konfigurasi keyring/TLS/allowlist, dan jalankan di database disposable/staging terlebih dahulu. Node 24 dipakai CI/container (minimum package tetap 22.18+). Jalankan `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `npm run build`. Dengan database disposable dipilih secara eksplisit, jalankan `npm run db:migrate -- --dry-run`, `npm run db:migrate` dua kali, lalu SQL/browser tests. Production migration memerlukan `MIGRATION_BACKUP_CONFIRMED=true`; migrator tidak dipanggil otomatis saat startup.

Migration 002 menambah session/revision/reconciliation/profile; 003 menambah delivery slot/circuit state dan lease owner; 004 menambah inbox alert, pending notification, cooldown dan acknowledgement. Existing channel menjadi revision awal. PUT `/api/channel/:id` sekarang **menyimpan draft**; publish melalui `POST /api/channel/:id/revisions/:revision/publish` dengan expectedActiveRevision dan changeSummary. Rollback membuat publish baru. UI Revisions menyediakan review/compare/publish/rollback; editor meminta summary, idempotency mode, profile, serta synthetic dry-run tanpa network. Channel dengan revision history ditolak oleh DELETE; stop untuk retire. Perubahan ini memerlukan penyesuaian automation lama yang mengandalkan update langsung.

Browser memakai `/api/auth/browser/login`, refresh cookie HttpOnly/SameSite=Strict/Secure production, CSRF dan token rotation/reuse detection; access token hanya di memori. Session localStorage lama dibuang, sehingga pengguna perlu login ulang. Endpoint Bearer `/api/auth/login` tetap tersedia untuk automation. UI refresh diserialisasi melalui Web Locks bila browser mendukungnya. Settings menampilkan/revoke session sendiri. Role dibaca dari SQL pada setiap request.

HTTP source menerima `Idempotency-Key` (printable ASCII 1–200, scope per channel, hanya hash disimpan). Default OPTIONAL; REQUIRED menolak tanpa key; DISABLED mengabaikan header namun HL7 control-ID dedupe tetap aktif. Payload sama/key sama memakai existing ID/status; perubahan payload menghasilkan IDEMPOTENCY_CONFLICT 409 dan audit; duplicate yang masih processing menghasilkan 409. Hash memakai representasi JSON yang diterima engine, bukan canonical JSON; perubahan urutan property dapat dianggap conflict. Key berlaku selama inbound message retained; tidak ada TTL terpisah. Retention otomatis default **false**, diaktifkan hanya setelah kebijakan/backup disetujui.

Profile validation: JSON Schema draft-07 via AJV (tanpa regex/format/remote ref/async/uniqueItems; schema max16 KiB dan cache bounded), HL7 types/versions/required fields, custom boolean QuickJS script. Contoh synthetic: `{"hl7":{"messageTypes":["ORU^R01"],"versions":["2.5"],"requiredFields":["MSH.10","PID.3"]}}`. XML entity declaration ditolak; XSD bukan fitur yang telah diimplementasikan.

Delivery mempunyai global/per-destination slot limit dan persisted circuit open/half-open. Ambiguous timeout/ACK ditahan sebagai dead letter; operator harus rekonsiliasi. Kegagalan response script setelah delivery accepted tidak mengirim ulang. Lease owner mencegah worker lama menimpa hasil claim baru. Exactly-once lintas sistem tetap memerlukan dedupe pada receiver.

Payload UI default redacted; ADMIN dapat memilih raw dengan audit. Copy menggunakan isi yang ditampilkan. MASK_JSON_PATHS dan MASK_HL7_PATHS dikonfigurasi melalui protected environment. Free-text/XML di-redact penuh; organisasi harus meninjau profil masking sebelum memakai PHI. Log memakai metadata allowlist. Tidak ada support bundle/raw export otomatis.

TLS MLLP opsional: MLLP_TLS_ENABLED + certificate/key/CA files untuk listener, mTLS default required. Sender memakai `mllps://host:port` dengan CA/hostname verification; certificate validity diperiksa Node TLS. Plaintext production memerlukan exception MLLP_PLAINTEXT_TRUSTED_NETWORK=true dan jaringan terisolasi yang disetujui. Verified PostgreSQL TLS dapat memakai PG_SSL_CA_FILE. Reverse proxy dan mounted env secret example: compose.production.example.yaml / deploy/nginx.conf. Runtime TLS/proxy/certificate renewal perlu verifikasi staging.

`npm run secrets:rotate -- --dry-run`, `npm run secrets:rotate` menggunakan current + previous keyring; baca runbook sebelum mengganti key. `db:backup`, `db:restore`, `db:verify-restore` memakai environment backup eksplisit, file terenkripsi/checksum dan restore **hanya empty local disposable database**. Production recovery tetap proses administrator. `/metrics` membutuhkan ADMIN dan diblok proxy public; webhook alert opsional punya cooldown/recovery persisten di SQL, dengan fallback memory saat database unavailable. Detail batasannya di runbook alerting.

Rollback aplikasi: stop inbound baru, rekonsiliasi in-flight deliveries, pertahankan tabel/kolom/history/keyring; rollback konfigurasi lewat revision API. Jangan drop migration tables/columns atau reset database. Binary lama yang mengubah channel langsung tidak boleh dijalankan bersamaan dengan binary V2.

V2 verification: 212 unit/API tests, 13 real disposable PostgreSQL scenarios and 13 browser tests passed; coverage exceeds the initial baseline. Actual encrypted dump/restore and active-delivery SIGTERM passed on synthetic databases. Docker/remote CI/hospital UAT/load/production DR remain unverified. Full evidence and remaining scope are recorded in the V2 report.


### Development operational controls (schema 5)

Current development includes a secret-preserving successor draft editor, stored-revision synthetic dry-run, separate DNS/TCP/TLS connection probes, canonical JSON idempotency, optional reservation TTL, revision-owned destination circuit tuning and audited idle-only reset. ADMIN settings expose effective configuration and an audited metadata diagnostic download. `npm run docs:check` checks the static OpenAPI structure; Playwright includes Axe accessibility scans.

Apply migration 5 before starting the new backend. `IDEMPOTENCY_RETENTION_HOURS=0` preserves prior dedupe lifetime; enable expiry only after receiver/retention policy review. Expiry releases reservations without deleting messages and holds active/failed deliveries. See [operational controls](docs/OPERATIONAL_CONTROLS.md), [follow-up evidence](docs/GAP_CLOSURE_REPORT_2026.md) and the [remaining gaps](docs/GAP_ANALYSIS_2026.md). Production approval still requires runtime verification and hospital UAT.
