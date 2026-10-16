# Changelog

## Preserve security through UI simplification — 2026-10-16

- Retain authentication, four-role RBAC, per-channel source keys and one-time display, rotation, payload redaction/raw audit, encryption, sandbox, safe errors, request limits, correlation and idempotency. No database, production data or environment secrets changed.
- Limit unsuccessful source API-key requests to 60 per IP/minute per process before more database lookups. Keep existing authentication/management limits and compatibility routes. Document failure-budget/NAT/distributed-limit implications.
- Require explicit allowlisting for private/loopback destinations, including development; reject prohibited metadata/link-local/unspecified/multicast addresses, pin DNS answers and retain redirect rejection. Preserve intentionally allowlisted hospital network destinations.
- Reject obvious placeholder/repetitive current secrets during production config loading. Add negative API tests, real logger leakage assertions, fail-closed raw auditing, DNS-rebinding/pinning and real redirect rejection tests.
- Verify 380 unit/API tests in 30 suites and 57 browser scenarios; coverage rises to 82.99% statements / 79.73% branches / 85.24% functions / 83.96% lines. Typecheck/lint/format/build, OpenAPI structure, targeted source scan and dependency audit (0 vulnerabilities) pass. Initial loopback sandbox test failure was corrected by rerunning with local-socket permission.
- Record each security control and unverified deployment requirements in [SECURITY.md](SECURITY.md). Deployed HTTPS/firewall/certificates, full Gitleaks/history scan, remote CI, fresh PostgreSQL concurrency and production operational qualification remain NOT TESTED in this review.

## English application interface — 2026-10-16

- Translate the remaining Indonesian source API-key helper into English and review application-authored UI/backend messages for mixed-language text.
- Use explicit en-US formatting for displayed dates, session/alert timestamps and message counters. Keep the browser's local timezone and existing stored values.
- Verify client build, workspace typecheck, lint, format and 57 browser scenarios. A synthetic browser check using id-ID also confirms English helper text, month names and number separators. Refresh the two source-editor screenshots. Initial formatting and screenshot-filter issues were corrected and their commands rerun successfully.

## Consistent dropdowns — 2026-10-16

- Standardize dropdown sizing, padding, chevrons, focus/disabled states and selected options across filters, channel forms, Messages and Settings. Supported browsers use an anchored, scrollable native picker; other browsers retain the system picker.
- Bound long labels and menus to the viewport, and give mobile search/filter controls room without horizontal page overflow.
- Let Escape dismiss an open picker before closing its enclosing dialog; extend the existing mobile keyboard/accessibility regression scenario.
- Verify client build, workspace typecheck, lint, format and 57 browser scenarios. Synthetic desktop/modal/mobile checks also pass for proportional menu bounds, scrollable options, keyboard selection, Escape and long labels; initial mobile overflow and dialog-dismissal failures were corrected before the final runs. No database/dependency changes.

## Focus mapping and move testing to Review — 2026-10-16

- Base this follow-up on development commit `1734591`. Keep Source → Transformation → Destinations → Review & Test and all existing engine capabilities.
- Make Transformation mapping-only: Source Field / Target Field, Add Mapping, and optional Advanced Custom Transformation Script. Keep Required/default inside collapsed Mapping options. Preserve existing wrapper metadata and legacy scripts without a root field or automatic Patient wrapper.
- Let Source own inbound format and each destination own its outbound format independently. Remove Step 2 format selectors, examples, sample input, preview/test actions, privacy controls and test-result banners.
- Move transformation tests, generated output, safe actionable errors and audited Advanced test options to Review & Test. Move explicit destination connection probes there after complete configuration; preview remains DNS/network-free, probes send no application data, and confirmed post-save synthetic delivery remains available.
- Add safe actionable preview-error guidance without changing the runtime pipeline, converter or database. Keep schema 1–7 and existing source/destination filters, transformers, routing, retries, monitoring, responses and revision behavior. No database data changed.
- Verify this follow-up with 345 unit/API tests across 28 suites and 57 browser tests. Typecheck, lint, formatting, client/server build, OpenAPI structural checks (46 paths / 50 operations), targeted source secret scan, local Markdown links and diff checks pass. Coverage increases from 81.90% / 78.61% / 83.63% / 82.96% to 82.09% statements / 78.80% branches / 83.84% functions / 83.12% lines. Capture six fresh synthetic screenshots; an additional screenshot-only browser case passes.
- Native PostgreSQL 19-test and compiled-runtime results below are historical evidence from `1734591`, not reruns for this follow-up. No fresh npm ci, dependency audit, database migration, Docker, hospital UAT, load or disaster recovery drill is claimed.

## Final simplification and Mirth-style flow — 2026-10-16

- Retain Source → Transformation → Destinations → Review, visual mapping and the complete source/destination pipeline. Add format-aware Basic validation, a Field/Operator/Value filter builder and explicit transformer configuration through Advanced.
- Separate destination filter, transformer and delivery settings. Remove response-script editors from new-channel UI while preserving legacy responses, validation profiles, filters, transformers, routing, retry and multiple destinations in configuration and runtime. Generate draft audit summaries automatically.
- Simplify Overview to six real metrics and Recent Failures. Keep Users, Roles, Audit and System information in Settings; retain sessions, operational alerts and diagnostic export through disclosures instead of raw runtime JSON.
- Preserve redaction and audited raw access. Show actual HTTP status, captured transport duration and exact complete-history attempts in Messages; unknown legacy or mixed-history values remain unrecorded. Add nullable request duration in migration 007; admission/backpressure events are excluded from delivery counts.
- Add safe code/message/requestId/details fields to persisted failed HTTP results while preserving the complete legacy result; verify FAILED/PARTIAL/IN-ERROR, FILTERED 200 and QUEUED 202 responses.
- Verify 332 unit/API tests across 28 suites, 53 browser tests, 19 native PostgreSQL tests, and compiled isolated-runtime health/readiness, metrics authorization and active-delivery SIGTERM. Typecheck, lint, formatting, build, OpenAPI structural checks and targeted source secret scan pass. Coverage rises to 81.90% statements, 78.61% branches, 83.63% functions and 82.96% lines.
- Apply migration 007 to MiniMirthDev after preflight; verify schema 1–7 and unchanged counts of 1 user, 1 channel, 1 destination, 2 messages and 1 destination log. Rebuilt development health/readiness return 200 and SIGTERM exits 0 without a payload send; the environment file is unchanged. No production data changes. A fresh native schema-7 backup/restore drill remains unverified because PostgreSQL client utilities are unavailable; production readiness remains incomplete.
- Verification is for the development working tree based on `a43c693`; see [the audit](docs/UI_SIMPLIFICATION_AUDIT.md), [manual and upgrade guidance](docs/MIRTH_LITE_UI.md#database-upgrade-dan-compatibility), and [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md).

## Remove endpoint copy and request examples — 2026-10-16

- Remove Copy endpoint, curl/Postman request examples and placeholder instructions from the shared endpoint display; retain the source URL and one-time API-key copy.
- Remove unused example generation and styles while preserving confirmed synthetic-send payloads and headers. Remove two export-only tests with the deleted feature; retain format/request coverage.
- Verify build, typecheck, lint, formatting, 301 unit/API tests and 45 browser tests. No backend or database changes.

## Simple filter choices — 2026-10-16

- Replace source/destination boolean textareas with explicit accept/filter or deliver/skip choices; keep custom conditions in Advanced.
- Preserve existing scripts until an explicit selection, including legacy bare boolean text, and retain custom edits while switching choices.
- Verify build, typecheck, lint, formatting and 45 browser tests. No backend or database changes.

## Startup migration diagnostics — 2026-10-16

- Replace the generic missing-schema startup cause with safe MIGRATION_REQUIRED instructions; retain the schema-6 guard and manual migration requirement.
- Apply additive migration 006 to the configured development database after preflight; verify existing business counts and rebuilt backend health/readiness, then stop the test process cleanly.
- Verify 303 unit/API tests, including three startup regressions, typecheck, lint, formatting and build. A sandbox socket restriction required rerunning the suite with local loopback access.

## Documentation cleanup — 2026-10-16

- Remove ten superseded audit, baseline, plan, implementation and UI/migration reports; preserve their history in Git.
- Consolidate current UI guidance and remaining source/runtime scope in the Lite UI manual and production readiness matrix; retain security, architecture, operational and development recovery documentation.
- Repair documentation references and reconcile outdated session, schema, idempotency and metrics instructions. Application code, database and backups are unchanged.

## Visual transformation and four-step wizard — 2026-10-16

- Use Source → Transformation → Destinations → Review, with visual field mapping, Required/default values, input/output previews and optional scripts.
- Preserve source/destination filters and transformers, routing, multi destination, retry, timeout, monitoring and start/stop. Keep advanced configuration and custom scripts intact; make change summaries optional in the UI with automatic audit descriptions.
- Add a permission-controlled transformation preview before endpoint setup, using the existing sandboxed engine without network operations.
- Show Inbound Message, Source Processed Message, Outbound Message and Delivery Result. Record actual HTTP status through nullable schema-6 migration; immediately hide raw payload when permissions change.
- Verify 300 unit/API tests, 41 browser tests, 19 disposable PostgreSQL integration tests, CLI migration twice and compiled runtime startup/drain. Coverage increases to 81.11% statements, 76.82% branches, 82.75% functions and 82.25% lines.
- Migration 006 is required before deploying this build. No remote database migration was performed. See [usage, limitations and migration notes](docs/MIRTH_LITE_UI.md).

## Compact channel editor — 2026-10-16

- Reduce setup to Source → Destinations → Review; move optional source processing into Advanced.
- Collapse connection/key management, curl/Postman examples, sample previews and synthetic test delivery; retain one-time key display and delivery confirmations.
- Group destination details behind compact disclosures and retain configured indicators and existing values.
- Verify 267 unit/API and 33 browser tests, including closed-panel configuration retention, pending key operations, keyboard/mobile and accessibility. No backend or database changes.

## Development usability — 2026-10-16

- Simplify channel setup with optional source processing and Advanced settings; automatically describe the initial configuration while retaining required edit summaries.
- Add authoritative public source URLs, placeholder curl/Postman exports and post-save key/start/synthetic-test guidance.
- Add destination TCP/TLS connection tests without application payloads and structured, masked/audited output previews.
- Separate inbound, source processed and final destination payloads in Messages using captured revision/transport metadata.
- Preserve operator sessions after source-key failures; preserve TEXT input types in stored revision previews; improve Advanced text contrast.
- Verify 267 unit/API tests, 29 browser scenarios and 18 disposable PostgreSQL integration tests. No database migration or runtime production changes.

## Development source cleanup — 2026-10-14

- Remove the unused Modal `keepMounted` prop and backend `Direction` type.
- Remove 20 lines of CSS declarations superseded by later rules with the same specificity; retain the effective styles.
- Verify source import references, HTML/package entry points, maintenance commands and the dynamically loaded script worker. No unused source file was identified; retain database backups, migrations and operational tools.

## Unreleased — production hardening V2

Memory-only UI access tokens and rotating HttpOnly refresh sessions; CSRF and family revocation; keyed encryption and controlled rotation; safe metadata logs and redacted/raw permission; optional scoped HTTP idempotency; encrypted channel draft/publish/rollback; channel profile/dry-run; dead-letter reconciliation; lease owner fencing; persisted circuit/concurrency controls; protected metrics and initial webhook alert; safe encrypted disposable restore tooling; CI/security/container configuration and runbooks.

Safety behavior changes: channel PUT saves a draft; publish activates it. DELETE refuses retained revision history. Browser sessions from localStorage require fresh login. Default automatic retention is disabled. Ambiguous timeout/ACK goes to dead letter. Production plaintext MLLP requires an explicit isolated-network exception; verified PostgreSQL TLS remains mandatory. Review README and ADR before upgrading.


## Development follow-up — 2026-10-14

- Add schema-5 destination circuit policies, idle-only audited reset and guarded HTTP-key TTL with historical/canonical digest metadata.
- Add secret-preserving successor draft editing, stored revision dry-run and explicit pinned DNS/TCP/TLS probes without application payload.
- Add bounded XML profile rules, expanded metrics, ADMIN effective settings and audited metadata diagnostics.
- Reconcile active UI roles; protect dirty draft edits; add Axe checks and improve text contrast.
- Expand to 234 unit/API, 17 native SQL and 19 browser tests; raise coverage gates and add OpenAPI structural CI check.
- Production/hospital certification and remaining feature scope stay explicitly incomplete.


## Development database maintenance — 2026-10-14

- Add guarded snapshot backup, disposable restore/reset rehearsal and atomic single-ADMIN cleanup CLI with rollback/source-change/dependency protection.
- Support pg_dump exported snapshots without putting credentials in arguments; add process/encryption/file-permission regression tests.
- User-approved MiniMirthDev migration 1→5 and reset completed; admin@gmail.com and its original password hash preserved.
