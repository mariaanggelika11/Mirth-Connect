# Operational controls

## Security controls after UI simplification

See the [per-control security verification](../SECURITY.md#security-verification--16-october-2026). Authentication, all four roles, source credentials/rotation, redaction/raw auditing, encryption, sandbox limits, safe errors, correlation and idempotency remain backend enforced.

`OUTBOUND_ALLOWED_HOSTS` must explicitly include intended private/loopback destination hosts, even in development. DNS answers are checked and pinned for delivery/probes; metadata/link-local/unspecified/multicast destinations remain prohibited even when listed. A hostname allowlist entry intentionally permits its private DNS answers for hospital integrations; review DNS ownership and apply network egress rules.

Source API-key routes reject more than 60 unsuccessful requests per IP per minute in each process, before additional credential database lookups; completed successful requests are removed from the failure budget, while in-flight requests count temporarily. Processing errors also count. HTTP 429 includes `Retry-After`, safe error fields and a correlation ID. Counter: `rate_limit_inbound_rejections_total`. Existing auth 20/minute and management 300/minute limits remain. Shared NATs share budgets; multi-instance deployments need gateway/shared rate limiting and load verification.

Production rejects obvious example/repeated current JWT/encryption secrets and still requires a public HTTPS base URL, verified database TLS and exact destination allowlist. Generate independent random secrets through protected environment/mounts; use keyring rotation for existing encrypted data. The production compose example publishes proxy 443 only; verify actual firewall/ingress and direct port 9000 externally. Do not treat a configured HTTPS URL as evidence that transport/firewall has been tested.

## Migration and compatibility

Apply the complete migration chain **001–007** through `npm run db:migrate`, never as ad-hoc partial statements. Migrations are additive and transactional; the migrator's existing advisory lock serializes runs. Migration 005 preserves destination policy defaults `{}` (deployment defaults), legacy reservations keep NULL expiry, and legacy request hashes remain unchanged. New messages store both the old order-sensitive digest and a canonical digest, permitting rollback to the prior application artifact without losing the legacy reader's hash. PostgreSQL tests run the full migration set twice and check existing rows/counts. Backfill/index duration still needs staging/load verification on organization-sized data.

Current backend startup and restored-schema verification require versions **1–7**. Migration 006 adds nullable `MessageDestinationLog.http_status`; 007 adds nullable integer `request_duration_ms` for measured transport duration. Historical rows remain NULL. For schema-5/6 backups, first restore to the guarded disposable target using the corresponding prior artifact, then apply the complete migration chain and verify the upgraded copy with the correct keyring. Retain all schema version rows and columns when rolling back application code. See [backup compatibility](BACKUP_RESTORE_RUNBOOK.md) and [database upgrade guidance](MIRTH_LITE_UI.md#database-upgrade-dan-compatibility). Do not run a down migration, clear dedupe metadata, delete evidence, or rewrite Git history.

The latest native PostgreSQL 18.4 suite passed 19 scenarios, including repeat migration through 007 and the exact requested JSON→XML fixture sent to a real local HTTP receiver. Disposable compiled-runtime startup, health/readiness, metrics authorization and active-work SIGTERM also passed. The development `MiniMirthDev` preflight/migration reached schema 1–7 with unchanged counts: one user, one channel, one destination, two messages and one delivery log. This was an additive development upgrade, not a reset or production operation.

## Draft iteration and revision tests

`PATCH /api/channel/:id/revisions/:revision` requires `channel:write`, `expectedChecksum`, a nonempty `changeSummary` and a strict `patch` object. It creates a successor draft and archives its predecessor in one locked transaction. Concurrent edits or publish return `DRAFT_CONFLICT`/`REVISION_CONFLICT`; the active configuration remains unchanged until publish. Patchable API fields: channel name/idempotency mode, source type/format, and indexed destination name/enabled/retry/timeout/format/delivery policy. Index is zero-based, bounded, unique and scoped to that exact revision. Credential endpoints and all scripts stay server-side; these fields cannot be smuggled through a patch. The UI exposes the common name/idempotency/name/enabled/timeout subset and warns before discarding dirty edits.

`POST /api/channel/:id/revisions/:revision/dry-run` uses the encrypted stored configuration and a synthetic payload. It validates/filter/transforms/templates/converts without network or message persistence, audits the operation and masks the returned payload. It does not simulate downstream ACK/authentication/response scripts. Use synthetic fixtures exclusively; masking cannot make arbitrary trusted scripts a secret-policy boundary. Archived revisions cannot run or probe.

Ordinary `PUT /api/channel/:id` saves a draft and automatically classifies changed source, transformation, destinations and channel name. It writes only action metadata (`SOURCE_UPDATED`, `TRANSFORMATION_UPDATED`, `DESTINATION_UPDATED`, `CHANNEL_UPDATED`) alongside the existing `CREATE_CHANNEL_DRAFT`, in the same transaction. These events describe proposed draft changes; publish remains a separate audited activation. Summaries are generated for ordinary UI saves, while explicit administrative API summaries remain supported. Script bodies, profile contents, credentials and payloads are excluded from these events.

`POST /api/channel/:id/revisions/:revision/destinations/:index/test-connection` is a separate explicit network action. It audits before connecting, permits at most four active probes per process, resolves once, rejects prohibited resolved addresses, pins the socket, caps total DNS+handshake time at five seconds, and sends zero application bytes. HTTPS/MLLPS verify CA, hostname and certificate validity; MLLPS uses deployment CA/client certificate mounts. A reachable handshake does not prove application credentials, HL7 ACK behavior or successful clinical delivery. Plaintext results state the isolated-network requirement.

## Idempotency identity and expiry

JSON identity recursively sorts object keys, preserves array order and JSON value semantics, and limits structure depth to 100. Stored/sent payload remains unchanged. Legacy JSON reservations can be compared from their stored original payload; no evidence/hash rewrite is necessary. HL7/raw identity retains the previous wire serialization. Keys remain hashed and scoped per channel; conflicts return 409 and are counted once.

`IDEMPOTENCY_RETENTION_HOURS=0` is the default and preserves previous dedupe lifetime. An explicitly positive value sets expiry only for newly accepted HTTP-header reservations. Existing reservations and MSH-only dedupe do not acquire a TTL automatically. Expiry cleanup runs in bounded 100-row batches and on a keyed request under the reservation lock, independently of message/audit retention. It clears only the live unique reservation field; historical key hash, original payload, digests, attempts and correlation remain. Active inbound or active/queued/retrying/failed/dead-letter outbound work prevents release. Even resolved dead-letter records are conservatively held; this is deliberate duplicate prevention rather than an automatic resend mechanism. Enabling key reuse requires a receiver-approved retention and idempotency policy; it may permit a new delivery after the configured retention interval.

## Destination circuit policy

Optional `deliveryPolicy` fields: `failureThreshold` 1–100, `openSeconds` 1–3600, `maxConcurrency` 1–100. Missing fields inherit deployment defaults and remain bounded by the global slot limit. Policy is part of encrypted revision/configuration/accepted connector snapshots, sanitized diff and versioned import/export. Changing it creates a draft; publishing preserves configuration history and audit. Retries use their saved policy where present.

`POST /api/destination/:id/circuit/reset` requires `channel:write` and a fixed reason (`DESTINATION_RECOVERED`, `CONFIGURATION_FIXED`, `SYNTHETIC_TEST`). Reset holds the admission lock, refuses active slots with 409, retains attempts/messages, and audits the fixed reason. A stale or expired slot owner cannot subsequently overwrite circuit state. The UI requires destination-recovery confirmation. Reset is operational, not a claim that unknown deliveries are safe to repeat.

## XML rules

Basic validation stores `validationProfile.basicSyntax=true` and follows the inbound JSON/XML/HL7 format. JSON is parsed once at ingress or in the preview editor, preserving valid JSON scalar strings. Existing JSON-object-only presets remain unchanged; custom schemas/rules/scripts remain advanced options. Mapping required/default fields are enforced during transformation after source selection.

Source and destination simple filters compile Field/Operator/Value into their existing sandboxed `filterScript`, with canonical metadata for reopening the builder. Text comparisons operate on scalar values, numeric comparisons require finite numbers, and missing values do not satisfy comparisons, including not-equal. Presence checks distinguish missing paths from existing null/empty fields. Paths reject prototype access and values remain data. Intact generated XML filters/mappings use bounded parsing; arbitrary legacy scripts retain their original input. No additional engine stage or database column is introduced for either feature.

`validationProfile.xml` supports a literal root name, up to 50 required nonempty text-element paths and up to 50 allowed-text-value rules. Example synthetic configuration:

```json
{"xml":{"root":"Order","requiredPaths":["Order.ID"],"values":[{"path":"Order.Status","allowed":["NEW","UPDATED"]}]}}
```

Paths are dotted literal element names, including literal namespace prefixes; they are not XPath or namespace-URI expansion. Repeated matched values must all satisfy allowed values. Attributes and complex XSD are not supported. XML2JS strict parsing rejects malformed documents, DOCTYPE/entities, configured byte-limit violations, more than 20,000 nodes, and depth above 64. Error messages contain no XML values. XML/text viewer masking remains full redaction. Hospital-specific profile selection and UAT remain required.

## Metrics and diagnostics

`/metrics` remains ADMIN-authenticated and blocked at the public proxy. Added series include database pool total/idle/waiting, active delivery/script/inbound/retry workers, source/delivery lease recoveries, script timeout/memory failure, login failure, authentication/management rate-limit rejection, idempotency expiry/hit/conflict and counts by the four fixed channel states. MLLP active connections use a gauge, not a decrementing counter. No patient/channel-name/request-ID metric labels are accepted. Runtime counters/histograms reset per process; SQL gauges describe retained records. HA scrape/aggregation and load must be verified externally.

`GET /api/system/configuration` returns effective deployment-owned settings to ADMIN only. It does not expose keys, URLs, database credentials, certificate file paths or session token hashes. `GET /api/system/diagnostics` audits an ADMIN export of schema versions, aggregate counts, safe settings and process/pool metrics with `Cache-Control: no-store`. It excludes payloads, scripts, credentials, endpoints, clinical identifiers, logs and free-text notes. This is a metadata artifact, not a complete incident archive. Settings remain read-only until a reviewed mutable configuration design exists.

Message delivery detail reports actual HTTP status and `durationMs` from the captured transport attempt, excluding database work and response scripting. `attemptCount` uses complete saved attempt history; incomplete legacy metadata and admission waits show **Not recorded**. No synthetic 200, inferred duration or guessed attempt count is displayed.

## Deployment and rollback

Use a fresh staging release checkout and synthetic endpoints first:

```sh
npm ci
npm run docs:check
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run test:e2e
npm run secrets:scan
npm audit --audit-level=high
```

After an owner-confirmed backup/drill and staging migration, a deployment operator selects distinct migration/runtime environment files without placing secret values in shell history:

```sh
ENV_FILE=/secure/mirth-migration.env npm run db:migrate -- --dry-run
ENV_FILE=/secure/mirth-migration.env MIGRATION_BACKUP_CONFIRMED=true npm run db:migrate
ENV_FILE=/secure/mirth-runtime.env npm start
```

The paths are placeholders. Provision verified HTTPS/PostgreSQL TLS/MLLP certificates, secret mounts, least-privilege accounts, monitoring and production backup storage beforehand. No production operation was executed in this work. Runtime certification, Docker/remote CI, hospital UAT, load/security and DR remain required.

Rollback uses the previously tested application/container artifact and the same compatible keyring; preserve the additive schema and all evidence. Before downgrading, publish a revision compatible with that artifact: generated simple conditions on XML need the new binary's XML normalizer. Disable TTL in the deployment environment if returning to the previous retention semantics. Do not automatically restore an old database over current data or replay ambiguous deliveries. Use the disposable restore verification path to rehearse recovery; actual production restoration requires an owner-reviewed incident procedure.
