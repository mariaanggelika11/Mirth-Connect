# Changelog

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
