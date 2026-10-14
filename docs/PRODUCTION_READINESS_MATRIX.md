# Production readiness matrix

**NOT PRODUCTION READY. Acceptance criteria are not all satisfied.**

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| npm ci | PASS | Initial install and final-lockfile npm ci verified; npm install-script policy warnings recorded |
| Typecheck / lint / formatting / build | PASS | Commands rerun; see implementation report |
| Unit/API regression and coverage | PASS (212 tests) | Coverage gates use exact initial baseline; synthetic fixtures |
| PostgreSQL integration/concurrency | PASS (13 tests) | Dedicated /tmp PostgreSQL cluster and new mirth_test_* schemas |
| Repeated migration / existing-channel initial revision | PASS | CLI preflight + two migrations and runtime smoke on empty disposable DB |
| Browser permission/editor/revision workflow | PASS (13 tests) | Synthetic API fixtures; does not establish production API/browser integration |
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
