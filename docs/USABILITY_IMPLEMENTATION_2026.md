# UI/UX usability implementation — 16 Oktober 2026

## Hasil

Branch `development`, baseline `5ffc5a2`. Implementasi mempertahankan backend filter/transformer/response/template/validation/idempotency/retry/timeout/revisions, dan menyederhanakan alur Source → Processing → Destinations → Review → Save → Start → Test → Messages. Pengujian menggunakan fixture sintetis dan PostgreSQL disposable lokal; database remote dan backup existing tidak disentuh.

| Area | Perubahan | Compatibility / batasan |
| --- | --- | --- |
| Source endpoint | `PUBLIC_BASE_URL` otoritatif dari backend; copy endpoint/curl/Postman | Fallback `INBOUND_BASE_URL`, override `INBOUND_PATH` dan dua alias API existing dipertahankan. Production perlu public HTTPS eksplisit. |
| Source dasar | Default channel baru HTTP/JSON, key tetap terlihat sebagai pengaturan penting | Format/config existing tidak diubah. API key hanya sekali tampil, rotate menginvalidasi key lama. |
| Advanced source | Pilihan validasi none/basic JSON/custom; duplicate message protection Optional | Profil dan script existing tetap tersimpan. Basic JSON berarti root object JSON. |
| Processing | Pass-through default, transformer opsional, filter checkbox dan response Advanced | Filter dinonaktifkan dengan script kosong; script yang diedit masih dapat diaktifkan ulang sebelum Save. |
| Destination | Pengaturan dasar + Test connection; Advanced dibagi processing/delivery/response | Probe hanya DNS/TCP/TLS, dibatasi kapasitas dan SSRF. Tidak mengirim HTTP/patient payload. |
| Retry / timeout | Retry fields kondisional; timeout dalam detik | Data API tetap milidetik. Tidak menambahkan maximum-delay control yang belum didukung backend. |
| Review / dry-run | Ringkasan sederhana, input/source/destination/output bertahap dan error per tahap | Tidak melakukan DNS lookup/delivery. Masking default; raw memerlukan izin ADMIN dan audit. |
| Save / onboarding | Create memakai `Initial channel configuration`; Create key, Start, confirmed synthetic send, Open Messages | Edit tetap summary wajib di UI dan disimpan draft; publish/rollback tidak dilewati. Backend legacy summary fallback dipertahankan. |
| Messages | Original inbound, Source processed, outbound per destination, format flow, status/response, history | Metadata dari revision/destination snapshot; data legacy tidak ditebak. Format/credential tidak diambil dari konfigurasi terbaru. |
| Security UX | Raw warning, copy mengikuti masking, key memory-only/sekali tampil, request examples ber-placeholder | Connector-key 401 tidak me-refresh atau mengeluarkan session operator. |
| Accessibility | Labels, status feedback, keyboard/focus/modal, mobile, contrast Advanced | Automated Axe mencakup surface baru; manual UAT pengguna tetap diperlukan. |

## Migration dan database

**Tidak ada migration baru.** Schema tetap versi 5. Tidak ada perubahan atau penghapusan channel/message/user existing. Backend hanya menambah response metadata dan route; source endpoint lama yang tersimpan tidak perlu direwrite. Pemeriksaan nama source/format historis menggunakan snapshot terenkripsi existing.

Native PostgreSQL test menggunakan `ENV_FILE=/dev/null`, database lokal baru `mirth_disposable_usability`, schema `mirth_test_usability_20261016`, host loopback dan credential sintetis. Setelah 18 test berhasil, schema uji diverifikasi bersih, database disposable dihapus dan cluster dihentikan. Test baru membandingkan XML dry-run, payload di database/API Messages dan body yang benar-benar diterima HTTP receiver lokal; mencakup key rotation, penolakan key lama dan audit akses raw.

## Screenshot sebelum / sesudah

Semua screenshot memakai data dan API fixture sintetis; tidak ada source API key asli atau data pasien. Baseline diambil dari source `5ffc5a2` pada salinan sementara, hasil sesudah dari build implementasi. Screenshot Messages sesudah menggunakan tombol raw berizin pada fixture sintetis agar struktur output XML terlihat; default aplikasi tetap redacted.

| Tampilan | Sebelum | Sesudah |
| --- | --- | --- |
| Source | [Sebelum](screenshots/usability/before-source.png) | [Sesudah](screenshots/usability/after-source.png) |
| Processing | [Sebelum](screenshots/usability/before-processing.png) | [Sesudah](screenshots/usability/after-processing.png) |
| Messages payload | [Sebelum](screenshots/usability/before-payload.png) | [Sesudah](screenshots/usability/after-payload.png) |

## Verifikasi

| Command / scope | Hasil |
| --- | --- |
| `npm run typecheck` | PASS, kedua workspace |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run test:coverage` | PASS, 267 test / 22 suite |
| `npm run build` | PASS, frontend dan backend |
| `npm run test:sql` dengan env lokal disposable | PASS, 18/18 |
| `npm run test:e2e` | PASS, 29/29 Chrome browser scenarios, termasuk Axe dan keyboard/mobile |
| `npm run docs:check` | PASS, OpenAPI 3.1 struktur/references, 45 paths / 49 operations |
| `npm run secrets:scan` | PASS, targeted working-tree pattern scan, 0 findings; bukan full historical Gitleaks scan |
| `git diff --check` | PASS |
| Production domain / hospital systems | NOT TESTED; runtime verification dan hospital UAT masih diperlukan |
| Docker, load test, backup/restore ulang | NOT TESTED dalam scope UI ini; tidak ada perubahan container/schema/tool backup |

Coverage dibanding baseline terdokumentasi terakhir:

| Metric | Baseline | Sesudah |
| --- | --- | --- |
| Statements | 78.54% | 80.35% |
| Lines | 79.72% | 81.52% |
| Functions | 80.69% | 82.14% |
| Branches | 71.51% | 75.20% |

Regression mencakup JSON → XML, XML → JSON, HL7 → JSON, JSON → HL7, dry-run tanpa lookup/network, source/destination stages, masking/raw audit, dua bentuk raw flag, API-key/canonical/legacy/Bearer routing, destination probe tanpa bytes aplikasi, batas concurrency, existing custom profile/scripts, required edit summary, retry kondisional, post-save onboarding, response errors, existing publish/rollback, TEXT revision yang kebetulan berisi JSON, operator-session preservation, dan mobile/keyboard/Axe.

### Kegagalan yang ditemukan dan diperbaiki

- Runner snapshot awal memakai working directory sementara sebelum direktori dibuat; dibuat dulu lalu baseline build berhasil. Locator screenshot Messages semula salah (`Inspect`); dikoreksi ke tombol aktual `Open message` dan screenshot diambil ulang.
- Preview baseline sempat mencatat `/ready: ECONNREFUSED` karena fixture screenshot belum mengintersep readiness dan tidak menjalankan backend nyata. Fixture `/ready` ditambahkan dan keenam screenshot diambil ulang; screenshot bukan bukti health deployment production.
- Chrome / local listener awal diblokir sandbox (`EPERM`/Chrome `SIGABRT`). Command yang sama dijalankan dengan izin runtime lokal, lalu test/screenshot berhasil. Ini bukan kegagalan aplikasi yang disembunyikan.
- Lint awal menemukan tipe `import()` pada test baru; diganti type-only import lalu lint lulus.
- Test assertion lama mengharapkan preview tanpa masking; diperbarui untuk eksplisit meminta raw dengan ADMIN dan memverifikasi perilaku redacted terpisah. Satu assertion error-code semula tidak sesuai kode aktual `SCRIPT_EXECUTION_FAILED`; dikoreksi dan diulang.
- Browser fixture awal salah exact-label selector setelah helper text ditambahkan; disesuaikan dengan label aktual. Axe menemukan kontras Advanced/radio label 4.0/3.89, diperbaiki menjadi `#5b687d` tanpa menurunkan assertion aksesibilitas.
- Setup PostgreSQL sementara awal belum memiliki symlink dylib karena install scripts dinonaktifkan; script paket diperiksa dan hydration dijalankan. `initdb` shared memory juga perlu runtime permission lokal. Cluster kemudian berjalan di loopback dan seluruh 18 integration test lulus.
- Review menemukan Open Messages dapat ditutup ketika key request masih berjalan, source-key error bisa memicu expiry session UI, dan revision TEXT dapat keliru di-parse JSON. Ketiganya diperbaiki; test regression session dan TEXT ditambahkan.

## Konfigurasi dan penggunaan

Gabungkan variable berikut ke deployment environment tanpa menimpa secret existing, kemudian build dan restart sesuai prosedur deployment:

```dotenv
# Development
PUBLIC_BASE_URL=http://localhost:9000
# Production: gunakan nilai berikut sebagai pengganti development
# PUBLIC_BASE_URL=https://connect.bulmar.tech
INBOUND_PATH=/api/message/inbound
```

`PUBLIC_BASE_URL` harus URL backend/reverse proxy yang benar, bukan URL browser yang ditebak otomatis. Untuk deployment dengan prefix, pastikan reverse proxy meneruskan path tersebut dengan benar. Bila client lama masih memakai `/api/inbound/:channelId`, endpoint tersebut tetap tersedia. Key per channel tetap wajib pada production untuk alur source API-key.

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm start
```

Jangan menjalankan `db:reset-development` untuk upgrade UI. Tidak ada migration/reset yang dibutuhkan. Manual label dan langkah operator diperbarui pada [UI_UX.md](UI_UX.md#simplifikasi-usability--16-oktober-2026).

## Remaining issues / runtime verification

- Test connection menunjukkan reachability TLS/TCP, bukan HTTP 200, validasi aplikasi penerima, atau bukti delivery. Gunakan confirmed synthetic send dan Messages untuk membuktikan delivery.
- XML/text sengaja dimask penuh pada default view. ADMIN raw preview bersifat eksplisit dan diaudit. Hak akses raw tidak diperluas untuk mempermudah screenshot.
- Atur `PUBLIC_BASE_URL` dan restart pada server nyata; perubahan environment production tidak dilakukan dalam sesi ini.
- Real TLS/domain/reverse-proxy, source-system Postman import dan hospital workflow perlu verifikasi di deployment. Tidak ada request ke webhook eksternal untuk test otomatis.
- Native SQL + synthetic browser fixtures membuktikan integration dan UI secara terpisah; full browser against deployed hospital stack belum diuji.
- Maximum retry delay belum menjadi configurable backend field; UI mempertahankan retry attempts/interval dan perilaku exponential backoff existing.
- Tidak ada klaim production-ready baru; UAT, load/security review, backup/restore dan DR qualification tetap mengikuti readiness matrix existing.

## File yang diubah

Tidak ada dependency baru pada package/lock repository. Daftar berikut mencakup source, test, konfigurasi, manual dan screenshot implementasi.

- `.env.example`
- `CHANGELOG.md`
- `README.md`
- `client/e2e/ui.spec.ts`
- `client/e2e/usability.spec.ts`
- `client/src/components/ui/OperationalUI.tsx`
- `client/src/features/channels/ChannelForm.tsx`
- `client/src/features/channels/ChannelOnboarding.tsx`
- `client/src/features/channels/ChannelPage.tsx`
- `client/src/features/channels/ChannelTable.tsx`
- `client/src/features/channels/DestinationEditor.tsx`
- `client/src/features/channels/DryRunPreview.tsx`
- `client/src/features/channels/RevisionPanel.tsx`
- `client/src/features/channels/SourceEndpoint.tsx`
- `client/src/features/channels/channelDraft.ts`
- `client/src/features/channels/sourceRequest.ts`
- `client/src/features/monitor/LogDetailModal.tsx`
- `client/src/index.css`
- `client/src/services/api.ts`
- `client/src/types/monitor.ts`
- `client/test/api.test.ts`
- `client/test/channel-usability.test.ts`
- `client/test/source-request.test.ts`
- `compose.production.example.yaml`
- `docs/UI_UX.md`
- `docs/USABILITY_IMPLEMENTATION_2026.md`
- `docs/openapi.yaml`
- `docs/screenshots/usability/after-payload.png`
- `docs/screenshots/usability/after-processing.png`
- `docs/screenshots/usability/after-source.png`
- `docs/screenshots/usability/before-payload.png`
- `docs/screenshots/usability/before-processing.png`
- `docs/screenshots/usability/before-source.png`
- `server/src/app.ts`
- `server/src/config/env.ts`
- `server/src/routes/channel.routes.ts`
- `server/src/services/channel.services.ts`
- `server/src/services/connectionProbe.services.ts`
- `server/src/services/dryRun.services.ts`
- `server/src/services/message.services.ts`
- `server/src/services/monitor/mapping.ts`
- `server/src/services/monitor/repository.ts`
- `server/src/services/revision.services.ts`
- `server/src/utils/transport.ts`
- `server/test/hardening.test.ts`
- `server/test/sql.integration.ts`
- `server/test/usability-api.test.ts`
