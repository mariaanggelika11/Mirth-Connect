# Production readiness matrix

**NOT PRODUCTION READY. Acceptance criteria are not all satisfied.**

This is the consolidated record of verification boundaries and remaining scope. Latest source verification: fef0251 on development, 16 October 2026. Documentation cleanup does not rerun runtime tests. Detailed latest command results are in [the UI manual](MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi); older phase reports remain available in Git history and release changes in [CHANGELOG](../CHANGELOG.md).

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| npm ci / dependency install | Previously verified | Installation baseline passed; the latest UI change added no dependencies |
| Typecheck / lint / formatting / build | PASS | Latest source verification recorded in the UI manual |
| Unit/API regression and coverage | PASS — 300 tests, 25 suites | Statements 81.11%, branches 76.82%, functions 82.75%, lines 82.25%; synthetic fixtures |
| PostgreSQL integration/concurrency | PASS — 19 tests | Local disposable PostgreSQL 18.4; preview XML compared with actual HTTP payload, required-field rejection and actual HTTP status |
| Repeated migration / existing-channel initial revision | PASS | CLI migration run twice; schema versions 1–6 and nullable HTTP-status column verified; runtime smoke verifies initial revision |
| Browser permissions/editor/revisions/accessibility | PASS — 41 tests | Synthetic API fixtures; does not establish complete production API/browser integration |
| Health/readiness/metrics authorization/SIGTERM | PASS | Compiled backend on disposable database; accepted active delivery completes during shutdown |
| Current source secret scan | PASS — targeted scanner | No findings in latest source verification; historical Gitleaks evidence is separate from this targeted scan |
| Historical secret rotation | RUNTIME VERIFICATION REQUIRED | Credential-owner rotation confirmation is absent; see [secret rotation](SECRET_ROTATION_RUNBOOK.md) and [history cleanup](GIT_HISTORY_CLEANUP_RUNBOOK.md) |
| Dependency critical/high vulnerabilities | Previously verified — audit reported 0 | Recheck dependency audit for each release; no new audit performed for documentation cleanup |
| MLLP TLS/mTLS | PASS locally; RUNTIME VERIFICATION REQUIRED | Prior synthetic CA/hostname rejection tests; hospital certificates, renewal and expiry drills remain unverified |
| Docker build/start | RUNTIME VERIFICATION REQUIRED | Configuration/CI steps exist; local Docker execution has not been established |
| GitHub Actions / CodeQL / branch protection | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Check remote workflow runs and configure repository protection with owner authorization |
| Backup encryption/checksum checks | PASS in source suite | Synthetic roundtrip/tamper/wrong-key/process tests |
| Full pg_dump/pg_restore drill | Prior schema-5 synthetic drill PASS; current-schema/production drill REQUIRED | [Development reset record](DATABASE_RESET_2026.md) preserves backup/rehearsal evidence. No new native schema-6 backup drill: clients unavailable. Restore older archives to disposable storage, migrate and verify with the correct keyring |
| Production HTTPS / PostgreSQL TLS / certificate custody | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Code/examples exist; deployed certificate custody and renewal must be tested |
| HA / capacity / independent security review | NOT TESTED | Load, failover and external security review remain required |
| Hospital profiles/UAT / RPO/RTO / production DR | NOT TESTED | Organization owners, profiles, acceptance infrastructure and measured drills are required |
| Full requested feature completeness | PARTIAL | See remaining source scope below; production qualification is independent of source completeness |

## Remaining source scope

These limitations were carried forward from the earlier gap analysis rather than removed with the historical reports.

| Area | Remaining work |
| --- | --- |
| Revision editing and diff | Complete credential-preserving private endpoint/script editing in stored successor drafts and script-content diff. Current immutable successor editing exposes a bounded public subset; compare uses sanitized configuration |
| Settings | Add mutable, audited configuration storage before exposing editable deployment/security/masking settings. ADMIN effective settings are currently read-only |
| XML | Full XSD validation and selective XML masking remain unavailable. Bounded root/required-path/allowed-value rules exist; XML/text payload views use conservative full redaction |
| Dead letter / diagnostics | Bounded bulk resend with downstream reconciliation assurance and richer sanitized per-message exports remain unavailable. Current diagnostics export aggregate metadata, not a complete support/log archive |
| Alerting | Assignment/escalation policy and shared database-outage grouping need further work. Persistent cooldown/recovery/acknowledgement exist; outage fallback uses bounded process memory |
| Tracing and metrics | OpenTelemetry is not implemented. Broader metric semantics, distributed aggregation and production scrape behavior require review |
| Backup operations | Owner-managed offsite storage, lifecycle/retention, key custody and recovery qualification remain operational work |
| Export policy | Raw/script exports need a credential-content policy review; do not assume arbitrary trusted scripts are safe to export |
| Connectors | Additional connectors remain [roadmap items](CONNECTOR_ROADMAP.md) and are not offered as working UI controls |

## Runtime verification and ownership

Historical credential-owner rotation confirmation; HTTPS/PostgreSQL TLS/MLLP certificate custody and renewal; shared Alertmanager/outage grouping; Docker and remote CI execution; HA/load/security review; hospital profiles/UAT; production backup and DR drills; retention, RPO/RTO and incident ownership decisions remain required. See [threat model](THREAT_MODEL.md), [operational controls](OPERATIONAL_CONTROLS.md), [backup/restore](BACKUP_RESTORE_RUNBOOK.md) and [disaster recovery](DISASTER_RECOVERY_PLAN.md).

The user-approved development reset on 14 October 2026 upgraded MiniMirthDev to schema 5 and retained the selected ADMIN after an encrypted backup/disposable rehearsal. On 16 October, the reported startup failure was traced to that development schema lacking migration 006. Preflight and transactional migration succeeded; schema 1–6 and unchanged business counts were verified, and the rebuilt backend returned health/readiness 200 before clean SIGTERM. Startup diagnostics now expose MIGRATION_REQUIRED safely; the follow-up unit/API run passed 303 tests. These development checks do not certify production. See [the reset/recovery record](DATABASE_RESET_2026.md) and [migration compatibility](MIRTH_LITE_UI.md#migration-006-dan-compatibility).
