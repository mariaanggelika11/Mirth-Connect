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
- `docs/ARCHITECTURE.md`: desain engine; `docs/MIRTH_LITE_UI.md`: panduan pengguna; `docs/OPERATIONAL_CONTROLS.md`: operasi dan deployment.

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
| `PUBLIC_BASE_URL`, `INBOUND_PATH` | Origin publik backend yang dipakai pada source endpoint; default lokal `http://localhost:9000` dan `/api/message/inbound`. Production wajib HTTPS eksplisit. `INBOUND_BASE_URL` tetap menjadi fallback kompatibilitas. |
| `OUTBOUND_ALLOWED_HOSTS` | Hostname/IP exact destination yang diizinkan; wajib di production. Alamat private/loopback memerlukan entry eksplisit, termasuk di development. Metadata/link-local tetap diblokir |
| `REQUEST_TIMEOUT_MS`, `PAYLOAD_LIMIT_BYTES` | Default 10 detik, 1 MiB |
| `SCRIPT_TIMEOUT_MS`, `SCRIPT_MEMORY_MB`, `SCRIPT_CONCURRENCY` | Default 1000 ms, 16 MiB, 4 worker aktif |
| `MESSAGE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS` | Default 30 dan 365 hari |
| `PUBLIC_REGISTRATION` | Default false; bila diaktifkan hanya VIEWER |

Atur `PUBLIC_BASE_URL=https://connect.bulmar.tech` pada server di balik reverse proxy; untuk development gunakan `PUBLIC_BASE_URL=http://localhost:9000`. UI menerima endpoint dari backend, tanpa menebak dari hostname browser. `PUBLIC_BASE_URL` mengungguli `INBOUND_BASE_URL`; hapus override `INBOUND_PATH` lama bila ingin memakai path default baru. Path source yang dikonfigurasi, `/api/inbound/:channelId`, dan `/api/message/inbound/:channelId` tetap dapat menerima source API key. Alur Bearer pada endpoint management tetap memerlukan permission `inbound:send`. `VITE_API_BASE_URL` kosong memakai same origin; `VITE_API_PROXY_URL` menentukan backend development. Jangan masukkan secret dalam variable `VITE_`.

Wizard channel memakai **Source → Transformation → Destinations → Review & Test**. Source menentukan connector dan inbound format; panel Sample message telah dihapus. Data uji hanya diisi pada Review & Test. Source mengikuti urutan nama channel → connector → inbound format → endpoint/API key setelah Save → Advanced berisi Validation dan Filter. Transformation menyediakan mapping **Source Field / Target Field** dengan satu header dan baris ringkas, **Add Mapping**, dan script opsional dengan editor penuh serta footer terpisah; Required/default/type conversion berada dalam **Mapping options**. Setiap destination menentukan outbound format secara mandiri, termasuk konfigurasi template HL7 v2.5. Eksekusi test dan preview tetap berada di Review & Test. Panduan terbaru dan batas verifikasi tersedia di [Mirth Connect Lite UI](docs/MIRTH_LITE_UI.md#field-discovery-v2-mapping-and-hl7--18-october-2026).

Destination menampilkan nama, connector, outbound format dan endpoint saja. Advanced destination settings memiliki bagian Transformation, Filter, Delivery dan HL7 settings yang tertutup. Connector diringkas menjadi HTTP/MLLP/TCP sender sambil mempertahankan enum/config lama; versi HL7 2.5 read-only, waktu/ID otomatis, dan override lama tetap tersimpan. Authentication/header editor dihapus dari UI; metadata tersimpan tetap dipertahankan dan backend tetap menegakkannya. Pengaturan baru menggunakan protected channel API dan secret environment server.

Review & Test menampilkan ringkasan/flow, Test input, Test transformation, generated output dan error yang aman. ADMIN langsung melihat preview lengkap melalui akses raw yang diaudit; role lain tetap mengikuti permission. **Advanced test options** menyediakan rincian proses dan pemeriksaan koneksi. Test connection juga berada di Review setelah konfigurasi destination lengkap; probe hanya DNS/TCP/TLS tanpa patient data, sedangkan transformation preview tidak melakukan DNS atau network request. Pengiriman sintetis setelah Save tetap memerlukan channel Running dan konfirmasi.

Source dan destination filter menyediakan builder **Field / Operator / Value**; aturan dikompilasi ke filter sandbox existing. Basic validation mengikuti format JSON/XML/HL7 dan disimpan sebagai `validationProfile.basicSyntax`; custom profile/script lama tetap tersedia. Overview menampilkan status operasional, sementara Settings mengelompokkan Users, Roles, Audit log dan System information.

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

Build terbaru memerlukan migration **001–008**. Migration 006/007 menambah nullable HTTP status/durasi transport. Migration **008_browser_session_policy.sql** menambahkan family sesi dengan idle/absolute deadline dan mencabut sesi browser lama sekali agar semua pengguna login ulang. Riwayat token, user, channel, pesan dan audit tetap dipertahankan; menjalankan migration lagi tidak mencabut sesi baru. Jalankan preflight, backup dan migration sebelum restart; lihat [session policy](docs/OPERATIONAL_CONTROLS.md#browser-session-policy--21-october-2026) dan [compatibility](docs/MIRTH_LITE_UI.md#database-upgrade-dan-compatibility).

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

Set `HOST`, CORS, hostname outbound, verified PostgreSQL TLS dan source key sebelum exposure. Gunakan HTTPS reverse proxy untuk UI/API. MLLP mendukung TLS/mTLS native; plaintext production memerlukan exception jaringan terisolasi yang disetujui.

## Authentication dan RBAC

Bearer JWT HS256: expiry, issuer, audience, `jti`; role dibaca ulang dari database per request. Browser menyimpan access token hanya di memori dan memakai rotating refresh cookie HttpOnly/SameSite=Strict/Secure production dengan CSRF/reuse detection. Logout mencabut session; kegagalan refresh mengakhiri session UI. Bearer automation tetap tersedia. CSP dan pembatasan script membantu mengurangi risiko XSS.

| Role | Izin |
| --- | --- |
| ADMIN | Semua izin, user/role/audit, channel, payload dan resend |
| DEVELOPER | Membuat/mengedit channel/script, start/stop, metadata/payload, inbound JWT |
| OPERATOR | Monitor, start/stop, payload dan resend; tidak mengedit/delete |
| VIEWER | Metadata channel/message saja; tidak melihat payload atau script configuration |

Admin API: `GET/POST /api/users`, `PUT /api/users/:id/role`; tidak mengembalikan password/hash. Perubahan role diaudit dan administrator terakhir tidak bisa diturunkan role. Registration menolak property role dari caller.

## Channel flow dan HTTP integration

Isi Source → petakan field pada Transformation → tentukan format/endpoint masing-masing destination → Review & Test → Save Channel → status STOPPED → Start RUNNING. Status PAUSED/STOPPED/ERROR menolak receive baru; work yang sudah diterima diselesaikan. Destination berurutan mengikuti ID existing. Destination yang dihapus dari form di-retire, sehingga log historis tetap ada. Channel dengan retained messages tidak dapat dihapus; gunakan stop dan retention.

Untuk source HTTP, buka Edit Channel → **Create / rotate source API key**. Key ditampilkan sekali pada aksi ini, disimpan AES-256-GCM dan tidak dikembalikan oleh list channel. Rotasi langsung membatalkan key sebelumnya.

```sh
curl -X POST http://localhost:9000/api/inbound/1 \
  -H "X-API-Key: $CONNECTOR_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"sample":"synthetic integration test"}'
```

Set `CONNECTOR_KEY` di terminal dari hasil rotasi, bukan dari source. Production API harus diakses lewat HTTPS. HTTP 200 mengembalikan hasil pemrosesan; periksa `status`: SUCCESS berarti transport menerima delivery, FILTERED berarti source filter mengecualikan pesan tanpa delivery. HTTP 202 berarti pekerjaan sudah tercatat durably dan masih antre. Respons mempunyai alias `messageId`/`status` serta `result` existing, termasuk custom source response legacy. Error memiliki `success`, `code`, `message`, `requestId`. Route success legacy seperti login/list channel mempertahankan format agar kompatibel.

REST destination mempunyai timeout dan limit response, tanpa redirect/proxy environment. Hanya 2xx sukses. Header correlation dan `Idempotency-Key` stabil membantu deduplikasi downstream; destination tetap harus menerapkannya. Credential URL/query dienkripsi; list mengembalikan URL yang dimask dan `credentialConfigured`. Perubahan URL yang menyimpan credential meminta re-entry, agar credential tidak hilang tanpa diketahui.

## HL7 / MLLP integration

Visual mapping V2 mendukung template HL7 v2.5 **ADT^A04, ADT^A01, ORU^R01 dan ORM^O01** per destination. Pilih outbound HL7 v2, lalu buka Advanced destination settings untuk tabel mapping inline (source field / HL7 field / description), dengan dropdown pencarian dan HL7 settings tertutup; header, UUID control ID dan timestamp UTC otomatis disusun bersama converter existing. Ini profil terbatas yang diuji, bukan implementasi seluruh HL7 atau sertifikasi profil rumah sakit. HTTP sender mendukung POST/PUT/PATCH dan content type per format; credential/header sensitif hanya direferensikan melalui environment server per ID destination. MLLP memakai Host/Port dan ACK yang diverifikasi. Lihat [konfigurasi, contoh dan QA](docs/MIRTH_LITE_UI.md#field-discovery-v2-mapping-and-hl7--18-october-2026).

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

Deduplikasi inbound HL7 memakai channel + sending application/facility + MSH-10 selama message masih retained. Pesan yang sama tidak dikirim ulang oleh receive; bila gagal, gunakan resend outbound terkontrol. HTTP/JSON mendukung scoped `Idempotency-Key` dan canonical request hash; pengaturan TTL dijelaskan pada [operational controls](docs/OPERATIONAL_CONTROLS.md#idempotency-identity-and-expiry).

## Transformer / filter

Script berjalan di QuickJS WebAssembly dalam worker terpisah, dengan input/output JSON saja. `process`, `require`, filesystem, database, network dan environment host tidak tersedia. Timeout, memory limit, worker heap limit, output limit dan concurrency cap aktif. Helpers `hl7ToJson`/`jsonToHl7` berjalan di interpreter tersebut, bukan sebagai callback dengan object host.

Transformer/template harus mengembalikan JSON/string yang valid; filter mengembalikan boolean; response script mengembalikan response. Script async/network tidak didukung. Tinjau script existing terhadap perubahan parser MSH dan repeated fields.

Source Message Validation kini menyediakan Field validation untuk JSON (Field/Type/Required dan aturan tambahan) serta Custom schema dengan contoh format. Basic/custom lama dipertahankan; input yang gagal tidak membuat delivery. Lihat [manual 8.3 Message Validation](docs/MIRTH_LITE_UI.md#83-message-validation) untuk semantik, batas format dan kompatibilitas envelope versi 1.

Source Filter memakai checkbox ON/OFF dan Simple condition tanpa dropdown accept/reject/custom atau editor source script. OFF menyimpan aturan valid terakhir sehingga tetap tersedia setelah Save/reopen; filter lama dipertahankan dengan notice dan penggantian eksplisit. Tidak ada migrasi database. Lihat [panduan Source Filter](docs/MIRTH_LITE_UI.md#filter-tanpa-script) untuk semantik field/operator dan compatibility.

Destination Filter memakai checkbox ON/OFF dengan kondisi terhadap Source Processed Message dan field picker; Advanced custom condition tersedia untuk kebutuhan script. Aturan OFF dan legacy script tetap tersimpan. Mapping HL7 tampil inline di Advanced destination settings; Disclosure Transformation membuka mapping inline untuk semua format di Advanced destination settings. Transformation umum default No transformation; Source Transformer hanya diedit di Step 2. Advanced Template lama merupakan script output setelah transformer dan tetap tersedia; template HL7 V2 baru memiliki konfigurasi nyata per message type. Filter/preparation failure tidak membuat network attempt atau retry; resend hanya memakai payload final yang terverifikasi. Tidak ada migration baru atau reset data. Lihat [panduan dan compatibility](docs/MIRTH_LITE_UI.md#field-discovery-v2-mapping-and-hl7--18-october-2026) dan [audit/test terbaru](docs/UI_SIMPLIFICATION_AUDIT.md#field-explorer-hl7-and-format-integration--2026-10-18).


Simple condition dan mapping menyimpan metadata versi dalam script canonical yang sama dengan pipeline existing. Path menggunakan own properties dan menolak prototype access; nilai diperlakukan sebagai data. Operator numerik memerlukan angka berhingga; field yang hilang tidak memenuhi comparison, termasuk not-equal. XML dinormalisasi dengan parser terbatas hanya untuk script visual canonical; custom script lama tetap menerima bentuk input sebelumnya. Required/default mapping diperiksa setelah source filter, sehingga pesan valid yang difilter tidak dipaksa menjalani transformation.

## Retry, monitoring dan retention

Outbound dicatat sebelum send, beserta payload final dan snapshot connector terenkripsi. Retry exponential mempunyai `retry_count`, `next_retry_at`, lease dan diagnostic error code; worker mengambil due work dari SQL tanpa sleep yang memblokir request. Retry memakai snapshot dan final payload, tidak menjalankan transformer/template ulang. Maksimum retry menghasilkan DEAD_LETTER. Manual resend memerlukan OPERATOR/ADMIN dan running channel.

Crash setelah network send bisa membuat hasil delivery ambigu. Lease yang expired ditandai `DELIVERY_OUTCOME_UNKNOWN`/DEAD_LETTER dan perlu rekonsiliasi operator; tidak dikirim ulang otomatis. Ini bukan jaminan exactly-once lintas sistem.

Monitor: `GET /api/message?page=1&pageSize=50&channelId=1&direction=IN&status=SUCCESS&search=example&dateFrom=2026-10-01T00:00:00Z`. Maksimum pageSize 100; payload tidak masuk list. Detail `/api/message/:id?logPage=1` menampilkan lima destination results per page dengan permission payload. Retry history dapat ditelusuri per page. `GET /api/audit?page=1` khusus ADMIN.

Messages memisahkan Inbound message, Source processed message, Outbound message dan Delivery result. HTTP status dan `durationMs` berasal dari attempt aktual; `attemptCount` memakai seluruh history yang lengkap. Metadata lama atau pekerjaan yang belum dikirim ditampilkan sebagai **Not recorded**, tanpa menebak dari timestamp atau retry counter.

Maintenance menghapus batch pesan SUCCESS/FILTERED/RECEIVED yang melewati retention dan tidak mempunyai outstanding/failed child. Unresolved errors/dead letters tidak dipurge otomatis; harus direkonsiliasi. Audit memakai retention terpisah. Atur retention sesuai kebijakan organisasi dan regulasi yang berlaku, serta sediakan backup/restore teruji.

## Testing dan build

Verifikasi terbaru pada development berbasis `30ceaa5`: **706 unit/API/integration tests / 46 files**, **102 browser tests**, typecheck, lint, format dan build lulus. Coverage: statements **87.44%**, branches **85.59%**, functions **89.74%**, lines **88.47%**. OpenAPI structural check (49 paths / 53 operations) dan targeted source secret scan juga lulus. Receiver HTTP/MLLP lokal sungguhan menguji delapan pasangan format; persistence memakai fixture. Tambahan sesi menguji idle/absolute/refresh/CSRF/revocation/race dan browser virtual-time. **Suite PostgreSQL terbaru 29 test, migration 008 dan deployed-runtime belum dijalankan untuk perubahan ini.** Bukti SQL/runtime sebelumnya tetap historis. Lihat [hasil dan batas verifikasi](docs/UI_SIMPLIFICATION_AUDIT.md#browser-session-hardening--2026-10-21).

```sh
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:e2e
```

Browser test default menggunakan Google Chrome macOS. Linux/Windows: set `CHROME_PATH` ke executable Chrome yang tersedia. Test browser menggunakan fixture synthetic dan tidak membaca database rumah sakit. Unit/integration API menggunakan SQL driver mock; transport/listener memakai loopback sungguhan.

Uji PostgreSQL **sungguhan**, memakai environment test yang menunjuk database disposable lokal dan berisi key sintetis, pada schema sementara yang terisolasi:

```sh
ENV_FILE=/secure/mirth-test.env PG_SCHEMA=mirth_test_$(date +%s) LOG_LEVEL=silent npm run test:sql
```

Path environment tersebut adalah placeholder; isi dengan konfigurasi test terpisah dari `.env` aplikasi. Script menolak schema `public`, membuat schema baru, menjalankan migration dan 29 skenario synthetic, lalu menghapus schema tersebut. Pengguna DB memerlukan izin CREATE schema. Bukti PostgreSQL 18.4 sebelumnya mencakup migration 001–007 berulang, login/channel/transport/monitor/logout, rollback, concurrent retry/dedupe, retention dan JSON→XML terhadap HTTP receiver nyata. **Suite terbaru 29 skenario, termasuk migration 008 dan session policy, belum dijalankan pada sesi ini**; PostgreSQL/Docker lokal tidak tersedia. Tabel `public` tidak dipakai oleh test ini.

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
- `cause=MIGRATION_REQUIRED`, `stage=migration`: schema belum memenuhi build. Verifikasi target dan backup, jalankan `npm run db:migrate -- --dry-run`, lalu `npm run db:migrate`, `npm run build` dan `npm run start`. Aplikasi tetap menolak startup sebelum migration lengkap.
- `TOKEN_INVALID`: login lagi setelah deployment/rotasi; token lama tidak memenuhi issuer/audience/jti.
- `CONNECTOR_UNAUTHORIZED`: buat/rotate key per-channel; JWT bukan credential source external.
- `DESTINATION_HOST_DENIED`: tambahkan hostname exact ke allowlist yang ditinjau administrator. DNS resolution dipin dan alamat link-local/metadata diblokir.
- MLLP AR: periksa MSH required fields, allowlist peer, channel RUNNING dan tepat satu filter cocok.
- `/health` liveness; `/ready` memeriksa database. SIGTERM/SIGINT menutup HTTP/MLLP, menunggu active work/worker dan menutup pool; deadline shutdown configurable.

## Migrasi PostgreSQL pada database existing

Konfigurasi backend sekarang memakai `DATABASE_URL`, bukan `SQL_*`. URL lokal ditujukan ke **MiniMirthDev**, bukan database lain pada server yang sama. `server/.env` tidak dibaca. Gunakan `PG_SSL=true` dengan verifikasi sertifikat untuk production; konfigurasi development lokal mengikuti koneksi PostgreSQL yang diberikan.

Migration mempertahankan nama tabel mixed-case, ID, password hash dan timestamp existing tanpa konversi timezone otomatis. Migrator memakai transaksi dan advisory lock. Jalankan seluruh migration 001–007 melalui `npm run db:migrate`; ikuti [deployment dan rollback](docs/OPERATIONAL_CONTROLS.md#deployment-and-rollback) serta [backup/restore](docs/BACKUP_RESTORE_RUNBOOK.md). Tidak ada username/password default atau credential database dalam source.

## UI / UX workspace

Navigasi memakai Overview, Channels, Messages dan Settings. Editor channel mengikuti empat langkah dengan advanced settings; detail message memakai drawer dan resend memerlukan review. Admin dapat mengelola pengguna dan melihat audit dari Settings. Detail fitur dan verifikasi: [manual UI](docs/MIRTH_LITE_UI.md).


## Production hardening dan readiness

Status pengujian dan pekerjaan tersisa dirangkum dalam [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md). Batas keamanan dijelaskan pada [threat model](docs/THREAT_MODEL.md). Aplikasi belum dinyatakan production-ready.

Sebelum upgrade: backup terenkripsi teruji, review konfigurasi keyring/TLS/allowlist, dan jalankan di database disposable/staging terlebih dahulu. Node 24 dipakai CI/container (minimum package tetap 22.18+). Jalankan `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `npm run build`. Dengan database disposable dipilih secara eksplisit, jalankan `npm run db:migrate -- --dry-run`, `npm run db:migrate` dua kali, lalu SQL/browser tests. Production migration memerlukan `MIGRATION_BACKUP_CONFIRMED=true`; migrator tidak dipanggil otomatis saat startup.

Migration 002 menambah session/revision/reconciliation/profile; 003 menambah delivery slot/circuit state dan lease owner; 004 menambah inbox alert, pending notification, cooldown dan acknowledgement. Existing channel menjadi revision awal. PUT `/api/channel/:id` **menyimpan draft**; publish melalui `POST /api/channel/:id/revisions/:revision/publish` dengan expectedActiveRevision dan changeSummary. Rollback membuat publish baru. UI Revisions menyediakan review/compare/publish/rollback; summary opsional di UI diisi otomatis untuk audit. Validation dan scripting berada di Advanced; Transformation hanya berisi mapping, sedangkan Review & Test menyediakan seluruh pengujian dan preview tanpa network. Channel STOPPED tanpa retained message dapat dihapus, termasuk revision awal pada duplikat baru. Channel dengan history memakai Archive yang mempertahankan pesan/revision/audit; pending work harus ditangani dahulu. Lihat [alur revision dan lifecycle](docs/MIRTH_LITE_UI.md#revision-publish-rollback-dan-lifecycle-channel--17-october-2026). Perubahan ini memerlukan penyesuaian automation lama yang mengandalkan update langsung.

Penyimpanan draft biasa menghasilkan audit area yang berubah: `SOURCE_UPDATED`, `TRANSFORMATION_UPDATED`, `DESTINATION_UPDATED`, atau `CHANNEL_UPDATED` untuk nama. Event hanya berisi metadata aksi dan tetap diikuti `CREATE_CHANNEL_DRAFT`; konfigurasi aktif berubah setelah publish. Custom summary API tetap didukung.

Browser memakai `/api/auth/browser/login`, access token **5 menit** di memori dan rotating refresh cookie HttpOnly/SameSite=Strict/Secure production. Backend memeriksa **idle 15 menit** dan **batas total maksimal 8 jam sejak login** pada setiap request browser; refresh/polling tidak memperpanjang aktivitas. UI memberi peringatan 1 menit sebelumnya, memperpanjang idle melalui aksi pengguna, menyinkronkan logout antar-tab, dan menampilkan kegagalan pencabutan sesi dengan Retry sign out. Token tidak masuk localStorage; marker logout hanya metadata tanpa credential. Migration 008 memaksa login ulang sesi lama. Endpoint Bearer `/api/auth/login` tetap tersedia untuk automation dengan expiry terpisah; source API key tidak terpengaruh. Settings menampilkan/revoke session sendiri dan role dibaca ulang dari SQL. Lihat [konfigurasi, rollout dan keterbatasan offline](docs/OPERATIONAL_CONTROLS.md#browser-session-policy--21-october-2026).

HTTP source menerima `Idempotency-Key` (printable ASCII 1–200, scope per channel, hanya hash disimpan). Default OPTIONAL; REQUIRED menolak tanpa key; DISABLED mengabaikan header namun HL7 control-ID dedupe tetap aktif. Payload sama/key sama memakai existing ID/status; perubahan payload menghasilkan IDEMPOTENCY_CONFLICT 409 dan audit; duplicate yang masih processing menghasilkan 409. Canonical JSON mengabaikan urutan property object dan mempertahankan urutan array. `IDEMPOTENCY_RETENTION_HOURS=0` mempertahankan masa dedupe sebelumnya; TTL positif hanya aktif setelah kebijakan receiver ditinjau. Retention otomatis default **false**, diaktifkan hanya setelah kebijakan/backup disetujui.

Profile validation: JSON Schema draft-07 via AJV (tanpa regex/format/remote ref/async/uniqueItems; schema max16 KiB dan cache bounded), HL7 types/versions/required fields, custom boolean QuickJS script. Contoh synthetic: `{"hl7":{"messageTypes":["ORU^R01"],"versions":["2.5"],"requiredFields":["MSH.10","PID.3"]}}`. XML entity declaration ditolak; XSD bukan fitur yang telah diimplementasikan.

Delivery mempunyai global/per-destination slot limit dan persisted circuit open/half-open. Ambiguous timeout/ACK ditahan sebagai dead letter; operator harus rekonsiliasi. Kegagalan response script setelah delivery accepted tidak mengirim ulang. Lease owner mencegah worker lama menimpa hasil claim baru. Exactly-once lintas sistem tetap memerlukan dedupe pada receiver.

ADMIN langsung melihat payload lengkap di Messages, Review & Test, dan test revision; setiap pengambilan raw diaudit. Role lain tetap mengikuti permission dan masking backend; API tanpa permintaan raw tetap redacted. Copy menggunakan isi yang ditampilkan. MASK_JSON_PATHS dan MASK_HL7_PATHS dikonfigurasi melalui protected environment. Pada respons masked, free-text/XML di-redact penuh; organisasi harus meninjau profil masking sebelum memakai PHI. Log memakai metadata allowlist. Tidak ada support bundle/raw export otomatis.

TLS MLLP opsional: MLLP_TLS_ENABLED + certificate/key/CA files untuk listener, mTLS default required. Sender memakai `mllps://host:port` dengan CA/hostname verification; certificate validity diperiksa Node TLS. Plaintext production memerlukan exception MLLP_PLAINTEXT_TRUSTED_NETWORK=true dan jaringan terisolasi yang disetujui. Verified PostgreSQL TLS dapat memakai PG_SSL_CA_FILE. Reverse proxy dan mounted env secret example: compose.production.example.yaml / deploy/nginx.conf. Runtime TLS/proxy/certificate renewal perlu verifikasi staging.

`npm run secrets:rotate -- --dry-run`, `npm run secrets:rotate` menggunakan current + previous keyring; baca runbook sebelum mengganti key. `db:backup`, `db:restore`, `db:verify-restore` memakai environment backup eksplisit, file terenkripsi/checksum dan restore **hanya empty local disposable database**. Production recovery tetap proses administrator. `/metrics` membutuhkan ADMIN dan diblok proxy public; webhook alert opsional punya cooldown/recovery persisten di SQL, dengan fallback memory saat database unavailable. Detail batasannya di runbook alerting.

Rollback aplikasi: stop inbound baru, rekonsiliasi in-flight deliveries, pertahankan tabel/kolom/history/keyring; rollback konfigurasi lewat revision API. Sebelum downgrade binary, publish revision yang kompatibel: simple condition pada XML memerlukan normalisasi yang tersedia di binary baru. Jangan drop migration tables/columns atau reset database. Binary lama yang mengubah channel langsung tidak boleh dijalankan bersamaan dengan binary V2.

Hasil verifikasi source terbaru tercatat di [manual UI](docs/MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi); status produksi dan kekurangan source tetap dicatat di [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md).


### Import channel XML

Use **Channels → Import from XML** as ADMIN or DEVELOPER. Upload a single channel document in this application's format, such as [channel-example.xml](docs/channel-example.xml), or an XML file exported by this application (format versions 1/2). Import creates a new **STOPPED** channel with its initial published revision, destinations and audit entry; it does not overwrite an existing channel or start delivery. Configure a new source API key and review destination credentials before starting it.

Native NextGen/Mirth Connect exports containing fields such as `sourceConnector` are **not supported** by this importer and are explicitly rejected. Patient-message XML is also different from channel-configuration XML. Missing/empty/malformed files, entity declarations, unauthorized uploads and prohibited destination hosts are rejected. Size limit follows `PAYLOAD_LIMIT_BYTES` (default 1 MiB). XML import does not execute transformation scripts or send messages.

Verified on 16 October 2026 with 20 real PostgreSQL integration scenarios, including multipart import/export roundtrip, revision/audit persistence and rejection without orphan channels. A real browser against a compiled backend and disposable PostgreSQL also passed login/file-picker/import/list/error checks, without mocked APIs. The temporary browser build used same-origin API configuration; environment files and existing databases were unchanged. Native Mirth migration compatibility remains unsupported.

### Development operational controls

Current development includes a secret-preserving successor draft editor, stored-revision synthetic dry-run, separate DNS/TCP/TLS connection probes, canonical JSON idempotency, optional reservation TTL, revision-owned destination circuit tuning and audited idle-only reset. ADMIN settings expose effective configuration and an audited metadata diagnostic download. `npm run docs:check` checks the static OpenAPI structure; Playwright includes Axe accessibility scans.

Apply migrations through version 7 before starting the current backend. `IDEMPOTENCY_RETENTION_HOURS=0` preserves prior dedupe lifetime; enable expiry only after receiver/retention policy review. Expiry releases reservations without deleting messages and holds active/failed deliveries. See [operational controls](docs/OPERATIONAL_CONTROLS.md) and [remaining scope](docs/PRODUCTION_READINESS_MATRIX.md#remaining-source-scope). Production approval still requires runtime verification and hospital UAT.


### Development database maintenance

`npm run db:reset-development` previews the configured development database. Destructive execution requires an exact target, a verified encrypted backup receipt, unchanged source fingerprints and an existing ADMIN to retain. `db:verify-development-reset` runs the rehearsal only on a restored local disposable database. These are operator CLI utilities; there is no UI reset button. The user-approved MiniMirthDev reset and retained login are documented in [DATABASE_RESET_2026.md](docs/DATABASE_RESET_2026.md).
