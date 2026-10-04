# Audit Summary

Audit dan perubahan dilakukan pada checkout lokal `mariaanggelika11/Mirth-Connect`, baseline commit `61f739b` (10 Januari 2026), pada **4 Oktober 2026 (Asia/Jakarta)**. Framework, route utama, dan identitas UI existing dipertahankan. Audit awal tidak mencakup push, deployment, perubahan production database, atau rewrite Git history. **Pembaruan berikutnya yang disetujui pengguna:** backend dan database development `MiniMirthDev` sudah dimigrasikan ke PostgreSQL; lihat [laporan migrasi](POSTGRES_MIGRATION.md).

**30 kelompok issue** dicatat pada audit awal: **P0 8**, **P1 10**, **P2 8**, **P3 4**. Angka ini kelompok temuan, bukan hitungan semua baris cacat. Perbaikan source mencakup kelompok tersebut; penutupan deployment/SQL/operational risk menunggu validasi yang dijelaskan di bawah. **Project belum dinyatakan production-ready untuk data rumah sakit.**

| Prioritas | Hasil |
| --- | --- |
| P0 Critical | Secret tracking/fallback, privilege injection, RBAC, sandbox, logging, CORS/CDN, source isolation dan connector credential/host restriction diperbaiki. Rotasi secret historis/TLS deployment tetap tindakan manual. |
| P1 High | Parser/ACK/MLLP, transaksi, reserve-before-send, resend, retry/dead letter, pagination, migrations/index/dedupe ditambahkan/diperbaiki. Enam skenario PostgreSQL nyata sudah lulus di schema sementara; migrasi MiniMirthDev dan login admin terverifikasi. |
| P2 Medium | Typed centralized config/UTC, batch channel queries, validation, audit/trace, lifecycle, UI permission/error, retention dan tooling diperbaiki. HA/load/retention policy perlu qualification. |
| P3 Improvement | README, diagram, CSS lokal/CSP, Dockerfile/compose dan automated coverage tersedia. Container belum dijalankan. |

# Critical Fixes

1. `.env`, `client/.env`, `server/.env` sudah dihapus dari Git index dan di-ignore, file lokal dipertahankan. Safe examples tersedia. Password SQL hardcoded pada receiver uji dihapus. Secret dalam history belum dihapus dan harus dirotasi.
2. JWT tidak memakai fallback. HS256, expiry, issuer, audience dan jti diperiksa. Role dibaca ulang dari DB; logout berhasil mencabut token. Browser menghapus session untuk seluruh 401/token invalid/expiry.
3. Public register dinonaktifkan secara default, hanya VIEWER bila diaktifkan, menolak role injection, bcrypt 12 rounds, password validation/byte limit, unique username. User + audit menggunakan transaksi. Unknown-user bcrypt comparison mengurangi timing discrepancy.
4. Middleware permission reusable menegakkan ADMIN/DEVELOPER/OPERATOR/VIEWER. Management user/role API dibatasi ADMIN dan mempertahankan administrator terakhir.
5. `vm2` dihapus. Script berjalan pada QuickJS WebAssembly dalam worker dengan waktu/memory/stack/heap/concurrency/output limits dan tanpa Node host globals/callbacks. Risiko versi lama diperiksa melalui [vm2 security advisories](https://github.com/patriksimek/vm2/security) dan [advisory sandbox escape](https://github.com/advisories/GHSA-99p7-6v5w-7xg8). Batas interpreter mengacu pada [QuickJS runtime documentation](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md).
6. Console logging raw payload/response/header dihapus dari engine dan test harness. Structured logs hanya identifier/status/code; production response tidak membawa SQL/stack/patient detail.
7. CORS sebelum routes dengan allowlist, Helmet/CSP, rate limiting management/auth, request ID, request/response size caps dan cache no-store.
8. External HTTP source menggunakan encrypted per-channel API key; production tidak menerima global fallback. MLLP memakai IP allowlist. Endpoint/snapshot/key disimpan AES-256-GCM; URL credential dimask. Destination host allowlist, DNS pinning, metadata/link-local denial, redirect denial, timeout dan limits aktif.

# Backend Changes

| File | Perubahan |
| --- | --- |
| `server/src/config/env.ts`, `db.ts` | Single validated root config, fail-fast, verified SQL TLS production, reusable pool, transaction helper |
| `server/src/app.ts`, `server.ts` | Middleware ordering, source/management separation, health/readiness, audit/user/import routes, bounded graceful shutdown |
| `server/src/middleware/auth.ts`, `errorHandler.ts` | Current-role RBAC, JWT/revocation, standardized safe error |
| `server/src/services/auth.services.ts`, `routes/users.routes.ts` | Safe registration/login, admin user/role API, transactional audited changes |
| `server/src/services/channel.services.ts` | Atomic create/update/delete/status, destination ownership validation, soft retirement/history protection, two-query channel list |
| `server/src/services/messageProcessor.services.ts` | Persist/validate/filter/transform/reserve/deliver/aggregate; final-payload resend; durable snapshots/retry; HL7 dedupe |
| `server/src/services/script*.ts` | Resource-bounded isolated script interpreter and pure helpers |
| `server/src/services/worker.services.ts` | SQL retry claims, lease recovery, bounded retention of resolved messages |
| `server/src/services/message.services.ts`, `destination.services.ts` | Bounded server pagination/filter/detail, metadata/PHI separation, audited payload reads |
| `server/src/services/xmlLoader.services.ts`, `routes/upload.routes.ts` | Real bounded multipart XML import, validation, entity-declaration rejection |

# Frontend Changes

- `contexts/AuthContext.tsx`, `services/api.ts`: restored session validated through `/auth/me`, expiry timer, logout/revocation, all-401 cleanup, backend error messages, network timeout.
- `ChannelPage/ChannelTable/ChannelForm`: permission controls, surfaced errors, preserved scripts/settings, filter/retry/timeout controls, source key generation, responsive tables. View-only roles do not receive script configuration from backend.
- `MonitorPage/LogDetailModal`: server pagination, direction/status/channel/search/date filters, loading/empty/error states, permission-gated detail, destination-result pagination, authorized resend.
- `ServerStatusIndicator`: handles actual boolean connection result. Health client uses same API origin and development proxy.
- `HL7Tree`: corrected server parser, repeated segments/fields/subcomponents, stale async-result protection.
- `client/index.html`, `index.css`, `vite.config.ts`: external executable CDN/import map removed; Tailwind built locally with CSP-compatible bundled assets. Existing style/layout remains recognizable.
- Generated `server/public` assets are no longer tracked; `npm run build` creates them.

# HL7 Changes

CR/CRLF/LF; MSH-driven separators; correct special MSH numbering; generic ADT/ORM/ORU/SIU/DFT/MDM; required MSH fields; repeated segments/fields, components/subcomponents and preserved escapes. ACK uses inbound sender/receiver/trigger/processing/version/control ID and HL7 UTC TS. Invalid/routing-rejected input returns AR; failure returns AE; AA follows durable successful/queued processing.

MLLP decoder handles complete/fragmented/multiple frames, UTF-8 boundaries, invalid frames and bounded buffering. Outbound waits for complete correlated positive ACK, including persistent connections, and rejects AE/AR/mismatch/close/timeout. RAW TCP uses unframed write, with a status that does not claim application acceptance.

HL7 inbound dedupe uses channel + sending application/facility + control ID while retained. Ambiguous shared-listener routing rejects instead of duplicating messages. Script filters must return booleans.

# Database Changes

`server/migrations/001_engine.sql`: baseline Users/Channels/Destinations/Messages/MessageDestinationLog if absent; audit/revoked-token tables; retry/lease/correlation/dedupe/snapshot fields; soft-retired destinations; source key; ACK diagnostics; unique username/dedupe and access-path indexes. UTC for new writes. Foreign-key history is retained on destination removal. Channel deletion refuses retained messages.

Migration is explicit and transactional; existing endpoint data is encrypted through migrator. A database schema was not provided in the original repository, so compatibility with the actual deployed SQL schema remains unverified. Old Eastern-time rows are not silently reinterpreted.

# Security Changes

Mandatory secrets/config validation, bcrypt/password validation, minimum-role registration, current-role permissions, admin management, JWT revocation/expiry, CORS/CSP/Helmet, PHI-free structured logging, request trace, encrypted configuration, safe errors, no-store API responses, bounded inbound/destination traffic, timeout and destination address controls. Read payload actions and configuration/security actions are audited.

No certificate/regulatory compliance claim is made. Network TLS, SQL at-rest/backups, host access and organization-specific PHI permissions must be validated in deployment.

# Testing Added

**127 automated unit/API/database-session-mocked/real-loopback tests passed** (11 Vitest files), plus **6 Chrome browser tests passed**. Coverage pada audit awal sebelum migrasi PostgreSQL: **71.50% statements, 63.23% branches, 69.72% functions, 73.00% lines** over configured backend + frontend-service coverage scope (browser code is not counted there).

Coverage includes login/register/duplicates/wrong password/JWT/role injection/revocation, role restrictions, body/CORS/readiness, HL7 field parsing/round trips/ACK, MLLP fragmentation/multiple messages/NACK/timeouts/routing, REST status/timeouts, RAW TCP, sandbox globals/constructor escape/infinite loop/memory/exception/state isolation, channel transaction commit/rollback, source stop, persisted-before-send, retry policy/dead letter/snapshot resend, worker claims/recovery, pagination and viewer PHI omission, XML restrictions, browser role controls/mobile/session expiry.

SQL assertions in regular tests use **database-session mocks**, with separate pg adapter tests for binding and transactions. `server/test/sql.integration.ts` has passed six native PostgreSQL scenarios in a newly created, isolated `mirth_test_*` schema, then removed that schema. Migration, admin login, channel list, paginated monitor, stats, users, audit and logout have also been verified on MiniMirthDev. Docker/load/failover/disaster recovery tests have not been executed.

Verification commands completed successfully: `npm install`, `npm run typecheck`, `npm run lint` (zero errors/warnings), `npm test`, `npm run test:coverage`, `npm run build`, `npm run test:e2e`, `npm audit` (0 vulnerabilities at check), `git diff --check`, env index/ignore checks. Node used: 24.18.1. These results are bounded by the tests described above.

# Dependencies Changed

Added Helmet, express-rate-limit, Zod, Pino, QuickJS, Multer, tsx, ESLint/typescript-eslint, Prettier, Vitest/coverage, Supertest and Playwright. Removed vm2/simple-hl7/socket.io, circular `file:..` workspace dependencies and unused ts-node-dev/rimraf tooling. Updated vulnerable compatible dependency resolutions. MSSQL 9 → 12 was part of the initial audit. After the user selected the existing PostgreSQL database, `mssql` and `@types/mssql` were removed and replaced with `pg`/`@types/pg`. Tailwind 4 local build replaces runtime CDN/Tailwind 3 vulnerable dependency tree. Express 4/React 19/Vite stack retained. Express type versions pinned via override to avoid mismatched v4/v5 definitions. Root lockfile is authoritative.

# Environment Changes

Backend uses root `.env` only. `JWT_EXPIRES_IN` is seconds; `BASE_URL`/`INBOUND_BASE` replaced by `INBOUND_BASE_URL`/`INBOUND_PATH`. New required encryption key, production outbound allowlist/verified SQL TLS. Source API keys generated per channel; optional development fallback key. Listener/network/script/retention/shutdown settings centralized. Frontend VITE variables are public; example contains no secrets. See README/environment examples for exact defaults and configuration.

# Migration Needed

1. Back up actual SQL database and restore a disposable copy.
2. Reconcile actual schema/unique usernames/legacy role values against `001_engine.sql`.
3. Configure PostgreSQL `DATABASE_URL` and encryption/JWT keys, run `npm run db:migrate`, then `npm run test:sql` with a unique `PG_SCHEMA=mirth_test_*`. This has been completed for MiniMirthDev; production rollout remains separate.
4. Review old scripts for corrected MSH indexes/repeated segment or field arrays and no asynchronous host access.
5. Generate source API keys and update external HTTP systems. Review exact peer/host allowlists.
6. Legacy failed outbound messages lack immutable connector snapshots; automatic resend of those is intentionally rejected. Reconcile/archive or reprocess with an explicitly reviewed channel configuration.
7. Review legacy Eastern-time timestamps before any conversion; new timestamps are UTC.

# Manual Action Required

- Rotate SQL/JWT/connector secrets ever committed, including credentials present in old receiver scripts. Review pre-hardening administrator accounts because public role injection was previously possible.
- Coordinate Git history cleanup separately. Env untracking does not remove prior secrets from commits/clones.
- Supply fresh environment/secret-manager values; protect/backup encryption keys. Key replacement requires controlled re-encryption of endpoints/source keys/snapshots.
- PostgreSQL migration and isolated live tests have passed. Review production rollout and administrator-managed backup/restore separately.
- Deploy HTTPS ingress and protected network/TLS tunnel for MLLP; verify SQL certificate and least-privilege runtime DB account.
- Approve message/audit retention and operational ownership of dead-letter reconciliation, backups, alerting and downtime recovery.

# Remaining Risks

1. **PostgreSQL is now the supported database**: MiniMirthDev migration and six isolated live scenarios passed; SQL Server is no longer supported by this runtime. Existing channels still need integration acceptance with their actual systems.
2. **No production-readiness certification**: hospital HL7 profiles, full browser flows against live PostgreSQL, throughput, DB failover, concurrent multi-instance behavior and disaster recovery remain qualification work.
3. **Exactly-once across systems is not guaranteed**: ambiguous crash/network outcomes need reconciliation and downstream dedupe. JSON inbound does not yet dedupe automatically. Unresolved errors/dead letters are retained instead of automatically deleted.
4. **MLLP has no native TLS** and REST can target an HTTP endpoint; deployment must enforce protected transport policy. IP/host allowlists are controls, not encryption.
5. **Bearer token remains localStorage**: XSS risk remains despite CSP and removing CDN scripts. Logout revocation needs a successful server request; network failure leaves remote token validity bounded by expiry.
6. **One shared MLLP listener and baseline scheduler**: channels need nonambiguous filters; HA/large retry throughput needs separate qualification. SQL claim locking helps competing retry workers but does not qualify cluster routing.
7. **XML imports support documented Mini Mirth format**, not arbitrary native Mirth exports. Unsupported fields are rejected explicitly. No silent lossy conversion is provided.
8. **Historical secrets and configuration/data migrations need manual action**, including encryption-key recovery and review of pre-existing user grants. Current dependency audit status is a snapshot, not a guarantee against future advisories.
9. **Dockerfile/compose are supplied but untested** in this environment; validate build, resources, networking and certificate trust before deployment.

# How To Run

```sh
npm install
# For an existing .env, merge required fields instead of overwriting it.
cp .env.example .env
cp client/.env.example client/.env
# Fill secrets and PostgreSQL DATABASE_URL before the next commands.
npm run db:migrate
npm run bootstrap:admin
npm run build
npm start
```

For development use `npm run dev` and, in another terminal, `npm run dev:client`. Full setup/network examples and production requirements: [README](../README.md).

# How To Test

```sh
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:e2e
# Real PostgreSQL in an isolated, newly created schema:
PG_SCHEMA=mirth_test_$(date +%s) LOG_LEVEL=silent npm run test:sql
```

Set `CHROME_PATH` on non-macOS hosts. Unit/browser fixtures are synthetic and explicitly isolated from production data. See [architecture](ARCHITECTURE.md) for boundaries and [initial audit](AUDIT.md) for priority mapping.
