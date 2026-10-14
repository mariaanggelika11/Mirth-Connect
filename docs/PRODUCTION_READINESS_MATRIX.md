# Production readiness matrix

**NOT PRODUCTION READY. Acceptance criteria are not all satisfied.**

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| npm ci | PASS | Initial install and final-lockfile npm ci verified; npm install-script policy warnings recorded |
| Typecheck / lint / formatting / build | PASS | Commands rerun; see implementation report |
| Unit/API regression and coverage | PASS (238 tests) | Statements 78.54%, branches 71.51%, functions 80.69%, lines 79.72%; gates raised to previous verified V2 baseline; synthetic fixtures |
| PostgreSQL integration/concurrency | PASS (17 tests) | Dedicated /tmp PostgreSQL cluster and new mirth_test_* schemas |
| Repeated migration / existing-channel initial revision | PASS | CLI preflight + two migrations and runtime smoke on empty disposable DB |
| Browser permission/editor/revision workflow | PASS (19 tests) | Synthetic API fixtures; does not establish production API/browser integration |
| MLLP TLS/mTLS | PASS locally; RUNTIME VERIFICATION REQUIRED | Synthetic one-day certificate; CA/hostname rejection; hospital certificates and renewal not exercised |
| Health/readiness/idle SIGTERM | PASS | Actual compiled backend against disposable database |
| SIGTERM with active work / HA / load | PASS active SIGTERM; HA/load NOT TESTED | Synthetic delayed delivery completes during SIGTERM; sustained failover/load still required |
| Working tree secret scan | PASS | Targeted scan and Gitleaks 8.30.1; no active-pattern findings after synthetic header correction |
| Historical secret rotation | RUNTIME VERIFICATION REQUIRED | 17 environment indicators; credential-owner confirmation absent |
| Dependency critical/high | PASS | npm audit reports 0 after compatible proxy-addr fix |
| Docker build/start | BLOCKED locally; IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | No Docker CLI/daemon; CI has build/migrate/start/readiness steps |
| GitHub Actions / CodeQL / protection | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Workflow files exist; no push/settings mutation performed |
| Backup encryption/checksum unit checks | PASS | Synthetic file roundtrip/tamper/wrong-key tests |
| Full pg_dump/pg_restore + verification drill | PASS synthetic; RUNTIME VERIFICATION REQUIRED for production | Official PostgreSQL client tools built only in /tmp; full encrypted dump/restore verification passed |
| Production HTTPS / PostgreSQL TLS / cert custody | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Examples/code supplied; no production infrastructure touched |
| Hospital UAT / independent security review / RPO/RTO | NOT TESTED | Owners, profiles and acceptance infrastructure must be supplied |
| Full requested feature completeness | NOT IMPLEMENTED in full | See GAP_ANALYSIS_2026.md; no production-ready claim |

Follow-up verification on `development`: 234 unit/API tests, 17 native PostgreSQL tests and 19 browser tests passed, including Axe scans for login/channel/revision surfaces. Schema version 5 adds destination policy plus HTTP reservation expiry/historical/canonical hash metadata. The final synthetic runtime and encrypted full backup/restore drill passed with this migration. OpenAPI structure/reference checks pass for 43 paths/47 operations; semantic review of the entire legacy contract remains required. Environment-owned settings are displayed read-only and diagnostics contain aggregate metadata only. None of these local checks certify production.

A later user-approved development reset upgraded the actual configured MiniMirthDev schema from 1 to 5 after a consistent encrypted snapshot, disposable restore and 10 reset-rehearsal checks. Only admin@gmail.com remains, with its original password hash; all operational rows were cleared. Actual backend health/readiness/auth/channel/stats/metrics checks returned 200. This is development verification and does not establish production readiness. See DATABASE_RESET_2026.md. The historical gap-closure counts above remain evidence of that earlier phase; latest unit/API count is 238.
