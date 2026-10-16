# Production readiness matrix

**NOT PRODUCTION READY. Acceptance criteria are not all satisfied.**

Latest lifecycle follow-up, 17 October 2026, based on `a1c1c24`: 403 unit/API tests, 22 real disposable PostgreSQL scenarios, and 61 synthetic browser scenarios cover the corrected draft/publish/rollback, deletion and archive flow. Coverage is 84.08% statements / 80.48% branches / 86.36% functions / 84.98% lines. Typecheck/lint/format/build, current source secret scan and OpenAPI structural checks (47 paths / 51 operations) pass. No existing application database was changed and no new migration is required. Earlier dated results below remain historical; deployed runtime/CI/UAT/load/DR qualification remains outstanding.

This is the consolidated record of verification boundaries and remaining scope. Latest security follow-up: development working tree based on `ce6db8d`, 16 October 2026. Fresh evidence is 380 unit/API tests, 57 browser tests, typecheck/lint/format/build, structural documentation checks, targeted source secret scan and dependency audit (0 vulnerabilities). The [security verification report](../SECURITY.md#security-verification--16-october-2026) records PASS / NOT TESTED for each control and the initial sandbox failure/rerun. Native PostgreSQL/runtime and development-migration evidence remains historical from `1734591`; those checks were not rerun. UI details remain in [the UI manual](MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi); earlier verification is preserved in Git history and [CHANGELOG](../CHANGELOG.md).

Later XML-import verification on the working tree based on `01ec384`: 383 unit/API tests pass, all 20 PostgreSQL integration scenarios were rerun on a new disposable local PostgreSQL 18.4 cluster, and a real browser imported a file through the compiled backend into that disposable database without mocked APIs. Empty XML is now rejected safely with 400. The complete 57-case mocked browser suite above was not rerun for this one-line parser fix. Database/environment files of the existing application were unchanged; temporary processes and data were removed. See [import behavior and compatibility](../README.md#import-channel-xml).

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| npm ci / dependency install | Previously verified | Installation baseline passed; the final simplification adds no dependencies. No fresh install is claimed for this verification |
| Typecheck / lint / formatting / build | PASS | Fresh checks for the mapping-only / Review & Test follow-up; client and server build pass |
| Unit/API regression and coverage | PASS — 403 tests, 30 suites | Statements 84.08%, branches 80.48%, functions 86.36%, lines 84.98%; includes lifecycle authorization, archive guards and stale-snapshot rejection |
| PostgreSQL integration/concurrency | PASS — fresh 22 tests | Isolated PostgreSQL 18.4 through migration 007; legacy competing drafts, canonical destination IDs across repeated rollback, unused-copy deletion, archive retention/reactivation protection plus prior XML import, idempotency/publish concurrency, refresh revocation and rotation scenarios |
| Repeated migration / existing-channel initial revision | Prior PASS at 1734591; not rerun | Isolated integration/runtime checks through schema versions 1–7; additive nullable HTTP-status and request-duration columns retained. Existing-channel revision and repeat migration checks pass |
| Browser permissions/editor/revisions/accessibility | PASS — 61 tests | Fresh synthetic API fixtures cover mapping-only Step 2, Review & Test, independent destination formats, filter/advanced/legacy configuration, delivery metadata, dashboard/settings, permissions, keyboard/mobile and accessibility. Six screenshots refreshed; one extra screenshot-only case passes. This does not establish complete production API/browser integration |
| Health/readiness/metrics authorization/SIGTERM | Prior PASS at 1734591; not rerun | Compiled backend on isolated PostgreSQL 18.4; health/readiness, protected metrics and accepted active delivery during SIGTERM pass. Rebuilt MiniMirthDev runtime also returns health/readiness 200 and exits cleanly without a test payload; production runtime qualification remains required |
| Documentation / local links / current source secret scan | PASS | Fresh OpenAPI structural check: 46 paths / 50 operations; 56 local Markdown links and diff check pass. Targeted secret scan has no findings; historical Gitleaks and credential rotation evidence remain separate |
| Historical secret rotation | RUNTIME VERIFICATION REQUIRED | Credential-owner rotation confirmation is absent; see [secret rotation](SECRET_ROTATION_RUNBOOK.md) and [history cleanup](GIT_HISTORY_CLEANUP_RUNBOOK.md) |
| Dependency critical/high vulnerabilities | PASS — fresh audit reports 0 across all severities | `npm audit --audit-level=high --json`; recheck for each release |
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

The current wizard is Source → Transformation → Destinations → Review & Test. Step 2 contains only Source Field / Target Field mappings, Add Mapping and optional Advanced Custom Transformation Script. Required/default remain in collapsed Mapping options. Input format belongs to Source; each destination owns its output format independently. Existing XML-root metadata is retained without a UI root field or an automatic Patient wrapper.

Review & Test owns synthetic input, transformation tests, generated output, safe actionable errors and optional audited raw preview under Advanced test options. Explicit TCP/TLS connection probes also live there after configuration is complete. Transformation preview performs no DNS lookup or delivery; connection probes send no application data. Confirmed post-save synthetic delivery remains separate. Preview-only helpers add safe actionable error guidance; the runtime pipeline and converter are unchanged.

Validation, simple Field/Operator/Value filters and source/destination transformer settings remain progressively disclosed. Response editors stay hidden while legacy response scripts, custom validation, arbitrary filters/transformers, routing, retries, multiple destinations, redaction and revision snapshots remain supported. Draft audit summaries remain automatic. This follow-up does not change the engine, converter or database schema; schema 1–7 remains required.

Migration `007_delivery_timing.sql` adds nullable integer `MessageDestinationLog.request_duration_ms`. Duration is captured around actual transport calls; admission/circuit/backpressure events do not become delivery attempts. Attempt counts use complete retained history for each outbound message. Legacy or mixed history without sufficient captured timing returns an unknown count rather than a fabricated value. Existing duration data remains `NULL`; no payload or business-data deletion is part of this upgrade.

## Runtime verification and ownership

Historical credential-owner rotation confirmation; HTTPS/PostgreSQL TLS/MLLP certificate custody and renewal; shared Alertmanager/outage grouping; Docker and remote CI execution; HA/load/security review; hospital profiles/UAT; production backup and DR drills; retention, RPO/RTO and incident ownership decisions remain required. See [threat model](THREAT_MODEL.md), [operational controls](OPERATIONAL_CONTROLS.md), [backup/restore](BACKUP_RESTORE_RUNBOOK.md) and [disaster recovery](DISASTER_RECOVERY_PLAN.md).

The user-approved development reset on 14 October 2026 upgraded MiniMirthDev to schema 5 and retained the selected ADMIN after an encrypted backup/disposable rehearsal. The earlier startup correction applied migration 006 and verified rebuilt development health/readiness. For the preceding final simplification captured in 1734591 on 16 October, migration 007 preflight and transactional migration also succeeded against MiniMirthDev: schema versions are exactly 1–7, with unchanged counts of 1 user, 1 channel, 1 destination, 2 messages and 1 destination log. The rebuilt development backend then returned `/health` 200 and `/ready` 200 on temporary loopback port 19092, without sending a payload, and exited 0 after SIGTERM. The environment file remained unchanged. The current mapping-only follow-up does not change database data or add migrations; its native SQL/runtime checks were not rerun. No production database was changed. Startup diagnostics retain safe `MIGRATION_REQUIRED` instructions.

Development migration and isolated test results do not certify production. See [the reset/recovery record](DATABASE_RESET_2026.md) and [database upgrade and compatibility](MIRTH_LITE_UI.md#database-upgrade-dan-compatibility).
