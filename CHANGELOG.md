# Changelog

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
