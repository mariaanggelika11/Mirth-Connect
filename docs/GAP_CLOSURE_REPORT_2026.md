# Gap closure report — 14 October 2026 (Asia/Jakarta)

## 1. Outcome

Implemented follow-up source fixes directly on development: private-data-preserving successor drafts, stored revision dry-run, explicit handshake probes, canonical JSON and independent opt-in reservation TTL, destination policy/audited idle-only reset, bounded XML rules, expanded metrics, effective settings/metadata diagnostics, live UI permissions, accessibility scanning and OpenAPI checks. Full requested scope and production certification are still incomplete; remaining items are retained in GAP_ANALYSIS_2026.md. No production database, credentials, deployment or repository settings were changed. No push or history rewrite was performed.

## 2. Baseline

Starting commit `4214c5f`; clean branch `development`, after the user's requested fast-forward and branch cleanup. Main remains the original baseline. Node v24.18.1, npm 11.16.0, Darwin arm64. Initial commands `npm run typecheck` and `npm test` passed (212 tests). Previous verified V2 coverage: statements 75.93%, branches 69.71%, functions 77.43%, lines 77.05%. Follow-up uses a new PostgreSQL 18.4 cluster in /tmp, loopback-only and synthetic disposable databases/schemas. No application .env database was selected.

## 3. Changes

| ID | Priority | Area | Change | Files | Migration | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-01 | P2 | Revisions | Strict successor draft patch, checksum/state conflicts, preserved scripts/credentials, discard warning | revision.services.ts; validator.ts; RevisionPanel.tsx | none | API, native concurrent edit/publish, browser | IMPLEMENTED for public subset |
| VAL-03 | P2 | Validation/probe | Stored synthetic dry-run with masking/audit; separate bounded pinned DNS/TCP/TLS handshake | dryRun.services.ts; revision.services.ts; transport.ts | none | no-bytes loopback, CA/hostname, API/browser | IMPLEMENTED |
| REL-07/08 | P1/P2 | Idempotency | Canonical JSON, legacy dual digest, opt-in guarded TTL without message deletion | utils/idempotency.ts; messageProcessor.services.ts; worker.services.ts | 005 | native legacy/order/concurrent TTL, unit depth | IMPLEMENTED |
| REL-09 | P1 | Circuit | Snapshot-owned per-destination policy, audited idle-only reset, fenced stale release | circuitBreaker.services.ts; channel.services.ts; DestinationEditor.tsx; ChannelTable.tsx | 005 | admission, half-open, reset/owner, native SQL | IMPLEMENTED |
| VAL-02 | P2 | XML | Literal root/required-text/allowed-value rules and bounded strict parse | profileValidation.services.ts; validator.ts | profile uses existing revision storage | synthetic namespace/repetition/malformed/entity/depth/node tests | PARTIAL — XSD/selective masking not implemented |
| OBS-01 | P1 | Metrics | Pool/worker/lease/script/login/rate/channel-state/idempotency series, proper MLLP gauge | metrics.services.ts; runtimeMetrics.ts; db.ts; script/worker/auth/listener services | none | API/resource/native metrics, current regression | IMPLEMENTED; production aggregation required |
| OPS-07/UI-02 | P2 | Diagnostics/settings | ADMIN read-only effective settings and audited aggregate bundle, no sensitive exports | system.services.ts; RuntimeSettingsPanel.tsx | none | API/native RBAC and browser download | PARTIAL — mutable settings not implemented |
| UI-03/04 | P1/P2 | UI access/a11y | Role reconciliation/hide privileged editors; Axe and improved contrast/focus/discard | AuthContext.tsx; ChannelPage.tsx; SettingsPage.tsx; index.css; ui.spec.ts | none | 19 browser tests | IMPLEMENTED for tested surfaces |
| DOC-01/OPS-03 | P2/P1 | Contract/governance | Actual channel/destination/patch/XML/policy schemas, new route docs and CI structural gate; raised coverage floor | openapi.yaml; check-openapi.mjs; ci.yml; vitest.config.ts | none | structural reference/operation checks | IMPLEMENTED; full legacy semantic review required |

## 4. Database

`005_operational_controls.sql` adds Destinations.delivery_policy JSONB, Messages.idempotency_key_hash/dedupe_expires_at/canonical_request_hash and a partial reservation expiry index, while backfilling historical reservation hashes. Existing records receive no automatic expiry. Schema version 5 is required at startup/restore verification. Migrations remain transactional and repeatable under the existing advisory lock; native repeat-run/data-preservation tests pass. Backfill/index duration on large production data is untested. Rollback preserves all additive columns/history and uses a prior application artifact; no data-dropping down migration is supplied.

## 5. Security

New operations retain channel-write/ADMIN permissions and read current database roles. Strict draft patches reject script/credential injection. Stored tests mask previews; probes audit before network and send zero application bytes. DNS is vetted and pinned, TLS verifies CA/hostname, and errors contain safe fixed codes. Diagnostics exclude payloads/scripts/endpoints/credentials/logs/notes. XML entities and structural limits are enforced. Gitleaks 8.30.1 source snapshot and targeted scanner report no findings. Historical credential rotation remains owner-unverified; ignored environment files were excluded from the published-source snapshot. No claim of a complete independent security assessment is made.

## 6. Reliability

Equivalent JSON key order no longer produces a conflict; arrays/types remain distinct. Canonical and legacy digests coexist for compatibility. TTL is disabled by default and cannot release active or failed/ambiguous outbound chains; historical hashes and messages remain. Concurrent successor drafts create one new revision; predecessor history is archived, active runtime unchanged until publish. Circuit policies are included in accepted snapshots and revision history. Reset refuses active slots and stale owners cannot later overwrite state. Hospital downstream idempotency, HA and sustained-load behavior remain unverified.

## 7. DevOps

Added OpenAPI structural check to existing CI and Axe dependency to browser tests. Coverage floor is raised to the prior V2 verified percentages. Current lockfile install succeeds with four inherited npm install-script policy warnings. Production Docker/remote CI/CodeQL still cannot be certified locally (no Docker CLI/daemon). Official PostgreSQL 18.4 client source was downloaded, SHA-256 checked and built under /tmp solely for the synthetic backup drill; these temporary clients were built without OpenSSL and are not production TLS clients. Use TLS-capable supported PostgreSQL clients in deployment.

## 8. Actual command results

| Command | Result | Evidence / boundary |
| --- | --- | --- |
| npm ci --no-audit --no-fund | PASS | 423 packages; install-script policy warnings, no install failure |
| npm run typecheck | PASS | both workspaces |
| npm run lint | PASS | source/tests/scripts |
| npm run format:check | PASS | all configured files |
| npm run test:coverage | PASS | 234 tests, 18 suites; statements 77.48%, branches 71.03%, functions 78.96%, lines 78.65% |
| npm run build | PASS | Vite frontend plus compiled TypeScript backend |
| npm run test:sql with explicit synthetic DATABASE_URL and new PG_SCHEMA=mirth_test_gap_v5 | PASS | 17 native PostgreSQL tests; repeated full migration set, legacy/canonical identity, TTL concurrency, successor edits, policy/reset and diagnostics |
| TEST_DATABASE_URL=.../mirth_disposable_gap_runtime_final npm run test:runtime | PASS | actual compiled startup, migration preflight/twice, existing-channel baseline, health/readiness/protected metrics and SIGTERM during active synthetic delivery |
| PATH=/tmp/mirth-gap-pg-clients/bin:$PATH TEST_DATABASE_URL=.../mirth_disposable_gap_runtime_final npm run test:backup | PASS | real encrypted/checksummed pg_dump, guarded single-transaction pg_restore, counts/encryption/message/login/health/readiness verification |
| npm run test:e2e | PASS | 19 browser tests using synthetic API fixtures; includes Axe WCAG scans, draft/conflict/probe/role/download/keyboard/discard workflows |
| npm run docs:check | PASS | 43 paths, 47 unique operations, path parameters and local references; structural, not full semantic API review |
| npm run secrets:scan | PASS | targeted scanner findings empty |
| Gitleaks 8.30.1 dir source snapshot --config .gitleaks.toml --redact --no-banner | PASS | no leaks found in tracked/unignored source snapshot; values never printed |
| npm audit --audit-level=high | PASS | 0 vulnerabilities |
| git diff --check | PASS | no whitespace errors |
| Docker build/start | BLOCKED | Docker CLI/daemon absent locally |
| Remote CI/CodeQL, production TLS/HA/load/UAT/DR | NOT TESTED | requires owner/infrastructure verification |

Failures were observed, corrected and rerun:

| Command / stage | Initial result/error | Root cause and correction | Final result |
| --- | --- | --- | --- |
| typecheck during edits | FAIL: Object.hasOwn unavailable in configured lib; misplaced release binding; unused import | used hasOwnProperty.call, corrected scoped binding, removed unused import | PASS |
| gap-workflows memory test | FAIL: timeout instead of memory code | OOM also exhausted diagnostic allocation; bounded diagnostic headroom and fixed resource-error codes, deterministic allocation fixture | PASS |
| unit regression | FAIL: missing rowsAffected in old mock; missing destination JSON parser; mock MAX selector ordering | corrected real body parser and SQL-shaped test fixtures | PASS |
| native SQL first follow-up | FAIL: 15/17 | schema test count changed a revision expectation incorrectly; optional policy inherited a default {} and overwrote preserved config | fixed expected count; use default-free strict patch policy schema; regression added | PASS 17/17 |
| browser accessibility | FAIL: 16/17 | real low-contrast muted/status/start text | darkened text in existing design; retained all WCAG rules | PASS 19/19 |
| npm run build during reinstall | FAIL: react-dom/client missing; tsc unavailable | build incorrectly overlapped npm ci, which replaced node_modules | reran after install completed | PASS |
| backup smoke immediately after failed build | FAIL: BACKUP_SMOKE_FAILED | compiled backup entrypoint absent after interrupted build | rebuilt sequentially and reran on final disposable DB | PASS |
| PostgreSQL client configure/build | FAIL: unsupported --without-ssl; generated catalog headers missing | used --without-openssl, generated backend headers before client build | PASS client build/full drill |
| npm run docs:check first run | FAIL: missing operation IDs on three legacy session/alert operations | added unique actual-route IDs | PASS |
| format:check after edits | FAIL: four files unformatted | formatted listed files | PASS |
| first escalated native SQL command | BLOCKED: automatic approval review timeout before execution | retried once as permitted, same disposable-only target | PASS |

## 9. Remaining risks

Settings are deployment-owned/read-only; full audited mutable settings storage is absent. Draft script/endpoint editing and script-content diff remain restricted. Full XSD/selective XML masking, bulk resend, full per-message support export, alert escalation/assignment, OpenTelemetry and offsite backup lifecycle remain source gaps. Resource limits/profile rules need hospital/load review. Runtime counters are per process; shared outage/HA grouping needs external monitoring. No production-readiness claim or complete-feature claim is made.

## 10. Manual actions required

Credential-owner rotation confirmation and separately approved historical cleanup; TLS certificates/renewal/secret custody; production PostgreSQL/runtime/migration accounts; Docker and remote CI execution/protection; receiver-approved key-retention policy; monitoring/Alertmanager routing; offsite backup retention/storage; named backup/incident owners and RPO/RTO; load/security review, hospital UAT and production DR drills. No organizational values are invented.

## 11. Deployment instructions

Use OPERATIONAL_CONTROLS.md for the safe ordered commands. Install/test/build a staging release, verify a backup, run migration preflight and migration using an owner-selected migration environment file, then start with a distinct least-privilege runtime environment. Apply schema 5 before starting this backend. TTL defaults to 0; configure it only after receiver-policy review. No production deployment was executed.

## 12. Rollback instructions

Deploy the previously tested application/container artifact while keeping the schema, keyring and all message/audit/revision evidence. The legacy digest remains available. Do not drop schema-5 fields, reset/clear dedupe history, rewrite Git history or restore old data over current evidence automatically. Rehearse restoration on a confirmed empty disposable target and use an owner-reviewed incident plan for production recovery.
