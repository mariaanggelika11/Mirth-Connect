# Migrasi PostgreSQL — 4 Oktober 2026

Atas permintaan pengguna, backend sekarang memakai PostgreSQL untuk database **MiniMirthDev** pada server yang diberikan. Database `sainora` dalam contoh URL pengguna tidak diakses atau diubah. Username/password database disimpan hanya dalam root `.env` lokal yang di-ignore, bukan source atau laporan ini.

## Hasil penerapan

- Sebelum migrasi: tabel existing `"Users"` (2 pengguna) dan `"Channels"` (16 channel).
- Sesudah migrasi dan pembuatan admin: 3 pengguna, **16 channel tetap ada**, dan satu record schema version 1.
- Nama tabel mixed-case, kolom existing, ID, password hash existing dan timestamp lama dipertahankan. Role dinormalisasi ke matrix RBAC seperti migration audit.
- Tabel `"Destinations"`, `"Messages"`, `"MessageDestinationLog"`, `"AuditLog"`, `"RevokedTokens"` dan `"SchemaMigrations"` ditambahkan beserta field dan index engine.
- Akun yang diminta (`admin@gmail.com`) dibuat sebagai **ADMIN** dengan bcrypt 12 rounds. Password tidak disimpan dalam source atau dokumentasi. Login dan logout berhasil diverifikasi.
- Kunci JWT/enkripsi lokal dilengkapi; `JWT_EXPIRES_IN` diubah ke 3600 detik. Session dari JWT secret lama perlu login ulang.

## Perubahan kode

`mssql`/`@types/mssql` diganti `pg`/`@types/pg`. Pool menggunakan satu client selama setiap transaksi, mengembalikan client setelah commit/rollback, dan mempunyai batas waktu koneksi/query. Query sudah memakai sintaks PostgreSQL asli: quoted identifiers, RETURNING, LIMIT/OFFSET, interval, boolean dan ON CONFLICT. Helper named-parameter membind nilai ke `$1`, `$2`, dan seterusnya; input tidak digabungkan ke SQL.

Worker mengklaim antrean menggunakan satu statement CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE RETURNING`. HL7 dedupe dan perubahan role administrator diserialisasi dengan transaction-scoped advisory locks. Retention menghapus child sebelum parent dalam transaksi bounded. Nilai bigint di API diubah menjadi number hanya bila masih dalam rentang integer aman.

Migrator menjalankan DDL dan enkripsi connector dalam satu transaksi serta mencegah migrasi bersamaan melalui advisory lock. Migrasi berulang tidak menambah schema version atau menghapus data. Ini menyesuaikan runtime ke PostgreSQL existing; tidak menyalin database SQL Server.

## Verifikasi

- **127 test otomatis**, **6 test browser**, typecheck, lint dan build lulus.
- **6 test PostgreSQL nyata** lulus di schema sementara yang dibuat khusus dan dihapus setelah test: alur login/channel/key/inbound/REST/monitor/logout, rollback, competing scheduler, migration berulang, concurrent HL7 dedupe dan retention.
- Schema `public` tidak dipakai test synthetic. Pemilik dua schema `mirth_test_*` yang dibuat selama dua percobaan test adalah runner; keduanya sudah dihapus oleh cleanup.
- Pada schema `public` MiniMirthDev: login ADMIN, `/api/auth/me`, `/api/channel`, `/api/message` (termasuk search/date), `/api/message/stats`, `/api/users`, `/api/audit` dan logout semuanya menghasilkan HTTP 200. Pemeriksaan hanya menampilkan status/count, tidak password, hash, token, atau payload.
- Dependency audit: **0 vulnerability** pada pemeriksaan terakhir.

## Batasan operasional

Backend memakai root `.env` saja; variable `SQL_*` lama tidak digunakan. `PG_SSL=false` sesuai koneksi development yang diberikan. Production mewajibkan TLS terverifikasi melalui `PG_SSL=true` dan `PG_SSL_REJECT_UNAUTHORIZED=true`; URL tidak boleh melewati konfigurasi tersebut dengan SSL/options overrides.

Backup export otomatis **tidak dibuat**: automatic approval review menolak penyalinan data pengguna/password hash ke lokal. Migrasi tetap diterapkan dengan transaksi dan tanpa penghapusan tabel/data existing. Backup penuh/restore database perlu dikelola administrator server; snapshot aplikasi bukan pengganti backup PostgreSQL.

Container, profil HL7 rumah sakit, load/HA dan pemulihan bencana belum diuji. Timestamp existing bertipe `timestamp without time zone` tidak dikonversi secara diam-diam. Review timezone data lama sebelum konversi terpisah.

## Menjalankan dan menguji

```sh
npm run build
npm start
# UI development yang terpisah
npm run dev:client
# Isolated live PostgreSQL tests; memerlukan izin CREATE schema
PG_SCHEMA=mirth_test_$(date +%s) LOG_LEVEL=silent npm run test:sql
```

Referensi implementasi transaksi dan locking: [node-postgres transactions](https://node-postgres.com/features/transactions) dan [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html).
