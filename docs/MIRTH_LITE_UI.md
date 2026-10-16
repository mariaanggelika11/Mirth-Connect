# Mirth Connect Lite UI — 16 Oktober 2026

## Perilaku produk

Wizard mengikuti **Source → Transformation → Destinations → Review**. Kemampuan engine tetap tersedia. Penyederhanaan mengubah cara konfigurasi ditampilkan dan menambahkan pemetaan field visual pada transformer existing.

| Kemampuan inti | Tampilan / implementasi |
| --- | --- |
| Channel, Start/Stop | Tetap pada Channels; konfigurasi existing dan tindakan operasi dipertahankan |
| Source connector, endpoint, API key | Tampil langsung pada Source; endpoint baru memakai placeholder ID sampai channel disimpan, berdasarkan konfigurasi backend |
| Source filter / transformer | Advanced source settings; filter tetap menentukan pesan mana yang diteruskan |
| Transformation | Input/output format, Add mapping, Required, Default value, XML root dan preview; Advanced transformation script untuk kasus kompleks |
| Destination connector | Nama, connector, outbound format dan endpoint; Test connection hanya TCP/TLS |
| Destination filter / transformer | Advanced destination settings; script dan credential existing tetap utuh |
| Multi destination dan routing | Default satu destination, Add Destination tetap tersedia, filter masing-masing destination menentukan routing |
| Retry, timeout, error handling | Konfigurasi Advanced dipertahankan, Review menampilkan nilai efektif, worker/circuit/dead-letter tidak dihapus |
| Message monitoring | Inbound Message, Source Processed Message, Outbound Message dan Delivery Result |
| Inbound/outbound payload | Payload per tahap dan destination snapshot tetap tersimpan; masking/raw permission dan audit tetap berlaku |
| Riwayat, publish, rollback | Tetap tersedia; summary di UI opsional, sistem menulis keterangan otomatis agar audit trail tidak kosong |

## Mapping tanpa script

Contoh JSON → XML: pilih JSON pada Source, XML pada Transformation, lalu gunakan **Use patient example** atau tambahkan mapping sendiri:

| Input field | Output field |
| --- | --- |
| patient_id | PatientID |
| name | PatientName |
| gender | Gender |
| date_of_birth | BirthDate |

`Required` menolak input yang tidak memiliki nilai wajib. Default value digunakan ketika nilai tidak ada, null atau kosong. Nilai `0` dan `false` dipertahankan; default yang dimasukkan melalui UI berupa string. Field tanpa mapping tidak ikut dimasukkan ke output. Tanpa mapping atau script, field asli diteruskan ke converter.

Dot paths membaca object bertingkat dan indeks array pada input; output bertingkat dibuat sebagai object. Maksimum 12 tingkat dan 100 baris. Target duplikat/tumpang tindih, prototype keys dan konfigurasi berukuran berlebihan ditolak. Untuk XML, root dapat diisi `Patient`. Wrapper root yang sudah dikonfigurasi tetap terlihat bila output format diubah. HL7 input menggunakan struktur parser existing: `PID.3` untuk scalar identifier, `PID.5.2` untuk component yang memang tersedia; rumah sakit dengan repetitions/profile berbeda tetap perlu memilih path yang benar. Mapping tidak melakukan array expansion atau konversi tipe otomatis.

Mapping dikompilasi menjadi source transformer JavaScript yang dijalankan QuickJS existing. Metadata version 1 tersimpan pada header script dan hanya dikenali bila script lengkap masih cocok dengan hasil compiler. Tidak ada kolom konfigurasi baru untuk mapping dan tidak ada penghapusan script lama. Script custom tetap berada di mode Advanced sampai pengguna secara eksplisit mengonfirmasi penggantiannya. Export/import XML channel existing membawa script beserta metadata mapping tanpa format baru.

XML pada mapping dinormalisasi secara terkontrol sebelum masuk worker; script custom lama tetap menerima input aslinya. DTD/entity declaration ditolak, parser dibatasi 20.000 nodes dan kedalaman 65, input/output tunduk pada batas payload dan QuickJS. Required-field/script failure memakai error code aman, tanpa menampilkan nilai pasien atau stack internal.

## Preview dan delivery

**Test transformation** memakai `POST /api/channel/preview-transformation`. Tujuan boleh belum memiliki nama/endpoint karena langkah Transformation mendahului Destinations. Endpoint ini menjalankan validasi payload, source filter/transformer, destination filter/transformer/template dan converter yang sama seperti runtime. Pemeriksaan koneksi sengaja dilewati dan dilaporkan pada warnings; tidak ada DNS lookup, HTTP/TCP send atau probe.

`POST /api/channel/dry-run` tetap memvalidasi konfigurasi koneksi lengkap seperti sebelumnya. **Test connection** melakukan DNS dan handshake TCP/TLS tanpa payload aplikasi. **Send synthetic message** setelah channel Running tetap meminta konfirmasi karena benar-benar dapat mengirim ke destination. Ketiganya berbeda dan tidak mengklaim pengiriman berhasil hanya berdasarkan preview/probe.

Preview default dimask. ADMIN dapat memilih **Show unmasked preview (access is audited)** secara eksplisit; XML/text dapat tersembunyi penuh pada redacted view. Data uji harus sintetis. Source, Transformation, Destinations dan Review tetap dapat dibuka kembali tanpa kehilangan mapping yang belum valid; Save/Continue tidak dapat melewati mapping yang belum lengkap.

## Messages dan keamanan akses

Summary langsung menampilkan inbound format, outbound format, status, destination dan Delivery Result. HTTP status berasal dari response transport aktual, termasuk 201/204/4xx/5xx; response body tetap mengikuti masking. Timeout, jaringan gagal, TCP/MLLP dan record lama tidak ditebak sebagai HTTP 200. Raw akses dicatat di audit dan copy mengikuti isi yang sedang ditampilkan.

Jika ADMIN kehilangan izin raw ketika drawer terbuka, raw content langsung disembunyikan dan UI meminta ulang versi redacted. Kehilangan izin payload menyembunyikan payload, termasuk pada riwayat/resend. Perubahan permission tetap dibaca ulang backend; frontend bukan satu-satunya kontrol.

## Migration 006 dan compatibility

`server/migrations/006_delivery_http_status.sql` menambah nullable integer `MessageDestinationLog.http_status` dengan batas 100–599. Record lama tetap `NULL`. Migration transactional/repeatable, tidak menghapus data. Chain migration, startup guard, reset rehearsal helper dan runtime smoke diperbarui ke versi 6. Tool reset hanya diperbarui kompatibilitas source; tidak dijalankan terhadap database remote dalam sesi ini.

Sebelum menjalankan build baru pada database existing:

1. Verifikasi target environment dan backup sesuai runbook, tanpa menimpa `.env` atau key existing.
2. Jalankan `npm run db:migrate -- --dry-run` dan tinjau hasilnya.
3. Setelah backup terverifikasi, jalankan `npm run db:migrate`; production juga memerlukan `MIGRATION_BACKUP_CONFIRMED=true` secara eksplisit.
4. Jalankan `npm run build`, kemudian restart melalui deployment procedure existing.
5. Verifikasi `/health`, `/ready` dan synthetic channel yang berizin.

Tidak ada migration/reset terhadap `MiniMirthDev` remote atau database production. Backup schema 5 tetap disimpan; untuk memakai verifier runtime versi baru, restore ke target disposable, apply migration 006 dengan keyring yang benar, lalu verifikasi schema 6. Native backup/restore drill baru belum dijalankan karena `pg_dump`/`pg_restore` tidak tersedia pada environment sesi ini.

Rollback source ke commit sebelumnya dapat mempertahankan kolom nullable baru; jangan drop kolom/data. Sebelum rollback backend lama, review channel XML yang baru memakai visual mapping: normalisasi XML khusus mapping memerlukan backend baru. Gunakan rollback revision channel yang sesuai bila kembali ke engine lama. Mapping JSON/HL7 tetap berupa script existing; seluruh rollback tetap memerlukan verifikasi sintetis.

## Validasi dan batas verifikasi

Pengujian menggunakan fixture sintetis serta PostgreSQL 18.4 baru pada loopback dengan environment terisolasi (`ENV_FILE=/dev/null`). Tidak ada credential production atau pengiriman ke rumah sakit/webhook eksternal. Native SQL 19/19 lulus, termasuk perbandingan preview XML dengan body HTTP aktual, routing/filter/multi destination, required rejection, actual HTTP status dan repeat migration. `npm run db:migrate` dijalankan dua kali pada schema lokal terpisah; versi tepat 1–6 dan kolom nullable integer diverifikasi. Runtime smoke membuktikan compiled startup, health/readiness, metrics authorization dan SIGTERM saat delivery aktif.

Test browser memakai API fixture untuk memeriksa UX/permission; actual pipeline/transport diverifikasi unit/API/native SQL secara terpisah. Production domain, hospital UAT, load test dan DR qualification tetap mengikuti readiness matrix existing. Tidak ada klaim production-ready baru.

| Command / pemeriksaan | Hasil akhir |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run test:coverage` | PASS — 25 suites, 300 tests |
| `npm run build` | PASS — client dan server |
| `npm run test:e2e` | PASS — 41 tests, termasuk keyboard/mobile, permission dan Axe accessibility |
| `npm run test:sql` dengan environment PostgreSQL disposable | PASS — 19 tests |
| `npm run db:migrate` dua kali dengan environment PostgreSQL disposable | PASS — schema 1–6, tidak ada migration ganda |
| `npm run test:runtime` dengan environment PostgreSQL disposable | PASS — startup, health/readiness, metrics 401 dan graceful shutdown delivery aktif |
| `npm run docs:check` | PASS — 46 paths, 50 operations; structural contract check |
| `npm run secrets:scan` | PASS — tidak ada temuan targeted-pattern scanner; bukan sertifikasi history/rotasi secret |
| `git diff --check` | PASS |
| Native backup/restore drill baru, Docker, hospital UAT, load/DR test | NOT TESTED pada perubahan UI ini |

Coverage meningkat dari baseline statements **80.35 → 81.11%**, branches **75.20 → 76.82%**, functions **82.14 → 82.75%**, lines **81.52 → 82.25%**.

Kegagalan selama pengembangan diperbaiki lalu diuji ulang: sandbox menolak loopback sockets/Chrome sehingga test dijalankan ulang dengan izin lokal; assertion required-field disesuaikan dengan kontrak existing `422 SCRIPT_EXECUTION_FAILED`; selector browser disesuaikan dengan label format; contrast indikator unsaved diperbaiki setelah Axe menemukan kegagalan. Hasil PASS di tabel adalah run terakhir setelah perbaikan, bukan hasil awal.

Screenshot dari browser test memakai data sintetis: [Source](screenshots/usability/lite-source.png), [Transformation](screenshots/usability/lite-transformation.png), [Review](screenshots/usability/lite-review.png).
