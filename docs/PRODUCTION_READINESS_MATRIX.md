# Production readiness matrix

**NOT PRODUCTION READY. Acceptance criteria are not all satisfied.**

This is the consolidated record of verification boundaries and remaining scope. Latest implementation verification: development working tree based on `a43c693`, 16 October 2026. The final simplification was verified with the commands below; no new commit identifier is assumed. Detailed latest command results are in [the UI manual](MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi); older phase reports remain available in Git history and release changes in [CHANGELOG](../CHANGELOG.md).

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| npm ci / dependency install | Previously verified | Installation baseline passed; the final simplification adds no dependencies. No fresh install is claimed for this verification |
| Typecheck / lint / formatting / build | PASS | Latest source verification recorded in the UI manual |
| Unit/API regression and coverage | PASS — 332 tests, 28 suites | Statements 81.90%, branches 78.61%, functions 83.63%, lines 82.96%; increased from 81.11% / 76.82% / 82.75% / 82.25%. Synthetic fixtures |
| PostgreSQL integration/concurrency | PASS — 19 tests | Isolated PostgreSQL 18.4 through migration 007; synthetic Siti JSON → XML compared with actual HTTP payload, validation/filter behavior, actual HTTP status, captured duration and complete-history attempt metadata |
| Repeated migration / existing-channel initial revision | PASS | Isolated integration/runtime checks through schema versions 1–7; additive nullable HTTP-status and request-duration columns retained. Existing-channel revision and repeat migration checks pass |
| Browser permissions/editor/revisions/accessibility | PASS — 53 tests | Synthetic API fixtures cover the four-step editor, simple filters, advanced/legacy configuration, delivery metadata, dashboard, settings, permissions, keyboard/mobile and accessibility. This does not establish complete production API/browser integration |
| Health/readiness/metrics authorization/SIGTERM | PASS — isolated runtime | Compiled backend on isolated PostgreSQL 18.4; health/readiness, protected metrics and accepted active delivery during SIGTERM pass. Rebuilt MiniMirthDev runtime also returns health/readiness 200 and exits cleanly without a test payload; production runtime qualification remains required |
| Current source secret scan | PASS — targeted scanner | No findings in latest source verification; historical Gitleaks evidence is separate from this targeted scan |
| Historical secret rotation | RUNTIME VERIFICATION REQUIRED | Credential-owner rotation confirmation is absent; see [secret rotation](SECRET_ROTATION_RUNBOOK.md) and [history cleanup](GIT_HISTORY_CLEANUP_RUNBOOK.md) |
| Dependency critical/high vulnerabilities | Previously verified — audit reported 0 | Recheck dependency audit for each release; no fresh dependency audit was performed for the final simplification |
| MLLP TLS/mTLS | PASS locally; RUNTIME VERIFICATION REQUIRED | Prior synthetic CA/hostname rejection tests; hospital certificates, renewal and expiry drills remain unverified |
| Docker build/start | RUNTIME VERIFICATION REQUIRED | Configuration/CI steps exist; local Docker execution has not been established |
| GitHub Actions / CodeQL / branch protection | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Check remote workflow runs and configure repository protection with owner authorization |
| Backup encryption/checksum checks | PASS in source suite | Synthetic roundtrip/tamper/wrong-key/process tests |
| Full pg_dump/pg_restore drill | Prior schema-5 synthetic drill PASS; current-schema/production drill REQUIRED | [Development reset record](DATABASE_RESET_2026.md) preserves backup/rehearsal evidence. No new native schema-7 backup/restore drill: `pg_dump`/`pg_restore` are unavailable. Restore older archives to disposable storage, migrate and verify with the correct keyring |
| Production HTTPS / PostgreSQL TLS / certificate custody | IMPLEMENTED — RUNTIME VERIFICATION REQUIRED | Code/examples exist; deployed certificate custody and renewal must be tested |
| HA / capacity / independent security review | NOT TESTED | Load, failover and external security review remain required |
| Hospital profiles/UAT / RPO/RTO / production DR | NOT TESTED | Organization owners, profiles, acceptance infrastructure and measured drills are required |
| Full requested feature completeness | PARTIAL | See remaining source scope below; production qualification is independent of source completeness |

## Remaining source scope

These limitations were carried forward from the earlier gap analysis rather than removed with the historical reports.

| Area | Remaining work |
| --- | --- |
| Revision editing and diff | Complete credential-preserving private endpoint/script editing in stored successor drafts and script-content diff. Current immutable successor editing exposes a bounded public subset; compare uses sanitized configuration |
| Settings | System information, Users, Roles and Audit are available; sessions, alerts and diagnostics remain under disclosures. Deployment/security/masking settings remain read-only; mutable audited configuration storage would be required before offering editing |
| XML | Full XSD validation and selective XML masking remain unavailable. Bounded root/required-path/allowed-value rules exist; XML/text payload views use conservative full redaction |
| Dead letter / diagnostics | Bounded bulk resend with downstream reconciliation assurance and richer sanitized per-message exports remain unavailable. Current diagnostics export aggregate metadata, not a complete support/log archive |
| Alerting | Assignment/escalation policy and shared database-outage grouping need further work. Persistent cooldown/recovery/acknowledgement exist; outage fallback uses bounded process memory |
| Tracing and metrics | Overview uses real channel counts, local-day inbound count, retained inbound success/failure counts and queued/retrying deliveries. OpenTelemetry, distributed aggregation and production scrape behavior still require review |
| Backup operations | Owner-managed offsite storage, lifecycle/retention, key custody and recovery qualification remain operational work |
| Export policy | Raw/script exports need a credential-content policy review; do not assume arbitrary trusted scripts are safe to export |
| Connectors | Additional connectors remain [roadmap items](CONNECTOR_ROADMAP.md) and are not offered as working UI controls |

## Latest source behavior and compatibility

The wizard remains Source → Transformation → Destinations → Review. Validation, simple Field/Operator/Value filters and optional transformer configuration are progressively disclosed. Destination filter, transformer and delivery settings have separate groups. Source/destination response editors are absent from new-channel UI; existing response scripts, custom validation, arbitrary filters/transformers, routing and multiple destinations remain supported by state/API/runtime/import-export. Draft audit summaries are generated automatically. Transformation preview reports network delivery `NOT SENT`; the separate synthetic-send action requires explicit confirmation. Normal channel delivery remains unchanged.

Migration `007_delivery_timing.sql` adds nullable integer `MessageDestinationLog.request_duration_ms`. Duration is captured around actual transport calls; admission/circuit/backpressure events do not become delivery attempts. Attempt counts use complete retained history for each outbound message. Legacy or mixed history without sufficient captured timing returns an unknown count rather than a fabricated value. Existing duration data remains `NULL`; no payload or business-data deletion is part of this upgrade.

## Runtime verification and ownership

Historical credential-owner rotation confirmation; HTTPS/PostgreSQL TLS/MLLP certificate custody and renewal; shared Alertmanager/outage grouping; Docker and remote CI execution; HA/load/security review; hospital profiles/UAT; production backup and DR drills; retention, RPO/RTO and incident ownership decisions remain required. See [threat model](THREAT_MODEL.md), [operational controls](OPERATIONAL_CONTROLS.md), [backup/restore](BACKUP_RESTORE_RUNBOOK.md) and [disaster recovery](DISASTER_RECOVERY_PLAN.md).

The user-approved development reset on 14 October 2026 upgraded MiniMirthDev to schema 5 and retained the selected ADMIN after an encrypted backup/disposable rehearsal. The earlier startup correction applied migration 006 and verified rebuilt development health/readiness. For the final simplification on 16 October, migration 007 preflight and transactional migration also succeeded against MiniMirthDev: schema versions are exactly 1–7, with unchanged counts of 1 user, 1 channel, 1 destination, 2 messages and 1 destination log. The rebuilt development backend then returned `/health` 200 and `/ready` 200 on temporary loopback port 19092, without sending a payload, and exited 0 after SIGTERM. The environment file remained unchanged. No production database was changed. Startup diagnostics retain safe `MIGRATION_REQUIRED` instructions.

Development migration and isolated test results do not certify production. See [the reset/recovery record](DATABASE_RESET_2026.md) and [database upgrade and compatibility](MIRTH_LITE_UI.md#database-upgrade-dan-compatibility).
