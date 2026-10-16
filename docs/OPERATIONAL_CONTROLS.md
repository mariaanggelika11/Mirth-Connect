# Operational controls

## Migration and compatibility

Apply `005_operational_controls.sql` through `npm run db:migrate`, never as an ad-hoc partial statement. Migration is additive and transactional; the migrator's existing advisory lock serializes runs. Existing destination policy defaults to `{}` (deployment defaults), legacy reservations keep NULL expiry, and legacy request hashes remain unchanged. New messages store both the old order-sensitive digest and a canonical digest, permitting rollback to the prior application artifact without losing the legacy reader's hash. PostgreSQL tests run the full migration set twice and check existing rows/counts. Backfill/index duration still needs staging/load verification on organization-sized data.

Current backend startup and restored-schema verification require versions **1–6**. Migration 006 adds nullable `MessageDestinationLog.http_status` for actual HTTP response metadata. For older backups, first restore to the guarded disposable target using the corresponding prior artifact, then apply the complete migration chain and verify the upgraded copy with the correct keyring. Retain all schema version rows and columns when rolling back application code. See [backup compatibility](BACKUP_RESTORE_RUNBOOK.md). Do not run a down migration, clear dedupe metadata, delete evidence, or rewrite Git history.

## Draft iteration and revision tests

`PATCH /api/channel/:id/revisions/:revision` requires `channel:write`, `expectedChecksum`, a nonempty `changeSummary` and a strict `patch` object. It creates a successor draft and archives its predecessor in one locked transaction. Concurrent edits or publish return `DRAFT_CONFLICT`/`REVISION_CONFLICT`; the active configuration remains unchanged until publish. Patchable API fields: channel name/idempotency mode, source type/format, and indexed destination name/enabled/retry/timeout/format/delivery policy. Index is zero-based, bounded, unique and scoped to that exact revision. Credential endpoints and all scripts stay server-side; these fields cannot be smuggled through a patch. The UI exposes the common name/idempotency/name/enabled/timeout subset and warns before discarding dirty edits.

`POST /api/channel/:id/revisions/:revision/dry-run` uses the encrypted stored configuration and a synthetic payload. It validates/filter/transforms/templates/converts without network or message persistence, audits the operation and masks the returned payload. It does not simulate downstream ACK/authentication/response scripts. Use synthetic fixtures exclusively; masking cannot make arbitrary trusted scripts a secret-policy boundary. Archived revisions cannot run or probe.

`POST /api/channel/:id/revisions/:revision/destinations/:index/test-connection` is a separate explicit network action. It audits before connecting, permits at most four active probes per process, resolves once, rejects prohibited resolved addresses, pins the socket, caps total DNS+handshake time at five seconds, and sends zero application bytes. HTTPS/MLLPS verify CA, hostname and certificate validity; MLLPS uses deployment CA/client certificate mounts. A reachable handshake does not prove application credentials, HL7 ACK behavior or successful clinical delivery. Plaintext results state the isolated-network requirement.

## Idempotency identity and expiry

JSON identity recursively sorts object keys, preserves array order and JSON value semantics, and limits structure depth to 100. Stored/sent payload remains unchanged. Legacy JSON reservations can be compared from their stored original payload; no evidence/hash rewrite is necessary. HL7/raw identity retains the previous wire serialization. Keys remain hashed and scoped per channel; conflicts return 409 and are counted once.

`IDEMPOTENCY_RETENTION_HOURS=0` is the default and preserves previous dedupe lifetime. An explicitly positive value sets expiry only for newly accepted HTTP-header reservations. Existing reservations and MSH-only dedupe do not acquire a TTL automatically. Expiry cleanup runs in bounded 100-row batches and on a keyed request under the reservation lock, independently of message/audit retention. It clears only the live unique reservation field; historical key hash, original payload, digests, attempts and correlation remain. Active inbound or active/queued/retrying/failed/dead-letter outbound work prevents release. Even resolved dead-letter records are conservatively held; this is deliberate duplicate prevention rather than an automatic resend mechanism. Enabling key reuse requires a receiver-approved retention and idempotency policy; it may permit a new delivery after the configured retention interval.

## Destination circuit policy

Optional `deliveryPolicy` fields: `failureThreshold` 1–100, `openSeconds` 1–3600, `maxConcurrency` 1–100. Missing fields inherit deployment defaults and remain bounded by the global slot limit. Policy is part of encrypted revision/configuration/accepted connector snapshots, sanitized diff and versioned import/export. Changing it creates a draft; publishing preserves configuration history and audit. Retries use their saved policy where present.

`POST /api/destination/:id/circuit/reset` requires `channel:write` and a fixed reason (`DESTINATION_RECOVERED`, `CONFIGURATION_FIXED`, `SYNTHETIC_TEST`). Reset holds the admission lock, refuses active slots with 409, retains attempts/messages, and audits the fixed reason. A stale or expired slot owner cannot subsequently overwrite circuit state. The UI requires destination-recovery confirmation. Reset is operational, not a claim that unknown deliveries are safe to repeat.

## XML rules

`validationProfile.xml` supports a literal root name, up to 50 required nonempty text-element paths and up to 50 allowed-text-value rules. Example synthetic configuration:

```json
{"xml":{"root":"Order","requiredPaths":["Order.ID"],"values":[{"path":"Order.Status","allowed":["NEW","UPDATED"]}]}}
```

Paths are dotted literal element names, including literal namespace prefixes; they are not XPath or namespace-URI expansion. Repeated matched values must all satisfy allowed values. Attributes and complex XSD are not supported. XML2JS strict parsing rejects malformed documents, DOCTYPE/entities, configured byte-limit violations, more than 20,000 nodes, and depth above 64. Error messages contain no XML values. XML/text viewer masking remains full redaction. Hospital-specific profile selection and UAT remain required.

## Metrics and diagnostics

`/metrics` remains ADMIN-authenticated and blocked at the public proxy. Added series include database pool total/idle/waiting, active delivery/script/inbound/retry workers, source/delivery lease recoveries, script timeout/memory failure, login failure, authentication/management rate-limit rejection, idempotency expiry/hit/conflict and counts by the four fixed channel states. MLLP active connections use a gauge, not a decrementing counter. No patient/channel-name/request-ID metric labels are accepted. Runtime counters/histograms reset per process; SQL gauges describe retained records. HA scrape/aggregation and load must be verified externally.

`GET /api/system/configuration` returns effective deployment-owned settings to ADMIN only. It does not expose keys, URLs, database credentials, certificate file paths or session token hashes. `GET /api/system/diagnostics` audits an ADMIN export of schema versions, aggregate counts, safe settings and process/pool metrics with `Cache-Control: no-store`. It excludes payloads, scripts, credentials, endpoints, clinical identifiers, logs and free-text notes. This is a metadata artifact, not a complete incident archive. Settings remain read-only until a reviewed mutable configuration design exists.

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

Rollback uses the previously tested application/container artifact and the same compatible keyring; preserve the additive schema and all evidence. Disable TTL in the deployment environment if returning to the previous retention semantics. Do not automatically restore an old database over current data or replay ambiguous deliveries. Use the disposable restore verification path to rehearse recovery; actual production restoration requires an owner-reviewed incident procedure.
