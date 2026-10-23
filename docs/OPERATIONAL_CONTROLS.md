# Operational controls

## Security controls after UI simplification

See the [per-control security verification](../SECURITY.md#security-verification--16-october-2026). Authentication, all four roles, source credentials/rotation, redaction/raw auditing, encryption, sandbox limits, safe errors, correlation and idempotency remain backend enforced.

`OUTBOUND_ALLOWED_HOSTS` must explicitly include intended private/loopback destination hosts, even in development. DNS answers are checked and pinned for delivery/probes; metadata/link-local/unspecified/multicast destinations remain prohibited even when listed. A hostname allowlist entry intentionally permits its private DNS answers for hospital integrations; review DNS ownership and apply network egress rules.

Source API-key routes reject more than 60 unsuccessful requests per IP per minute in each process, before additional credential database lookups; completed successful requests are removed from the failure budget, while in-flight requests count temporarily. Processing errors also count. HTTP 429 includes `Retry-After`, safe error fields and a correlation ID. Counter: `rate_limit_inbound_rejections_total`. Credential login/register aliases share a strict **20/minute/IP** budget. Session maintenance (`/me`, refresh, activity, own sessions) has a separate **300/minute/IP** budget, and browser/legacy logout share an independent **60/minute/IP** budget. Polling cannot consume the credential or logout budget; every auth scope remains bounded. Management stays 300/minute. Shared NATs share each scope's budget; multi-instance deployments need gateway/shared rate limiting and load verification.

Production rejects obvious example/repeated current JWT/encryption secrets and still requires a public HTTPS base URL, verified database TLS and exact destination allowlist. Generate independent random secrets through protected environment/mounts; use keyring rotation for existing encrypted data. The production compose example publishes proxy 443 only; verify actual firewall/ingress and direct port 9000 externally. Do not treat a configured HTTPS URL as evidence that transport/firewall has been tested.

## Migration and compatibility

Apply the complete migration chain **001–008** through `npm run db:migrate`, never as ad-hoc partial statements. Migrations are additive and transactional; the migrator's existing advisory lock serializes runs. Migration 005 preserves destination policy defaults `{}` (deployment defaults), legacy reservations keep NULL expiry, and legacy request hashes remain unchanged. New messages store both the old order-sensitive digest and a canonical digest. Migration 008 adds browser session families and revokes legacy sessions once, retaining history; see the policy below. PostgreSQL test scenarios run the full chain twice and check existing rows/counts; the latest 29-case suite has not run locally. Backfill/index duration still needs staging/load verification on organization-sized data.

Current backend startup and restored-schema verification require versions **1–8**. Migration 006 adds nullable `MessageDestinationLog.http_status`; 007 adds nullable integer `request_duration_ms` for measured transport duration. Historical rows remain NULL. Migration 008 supplies the family/idle metadata required by the new authentication middleware. For older backups, first restore to the guarded disposable target using the corresponding prior artifact, then apply the complete chain and verify the upgraded copy with the correct keyring. Retain all schema version rows and columns when rolling back application code. See [backup compatibility](BACKUP_RESTORE_RUNBOOK.md) and [database upgrade guidance](MIRTH_LITE_UI.md#database-upgrade-dan-compatibility). Do not run a down migration, clear dedupe metadata, delete evidence, or rewrite Git history.

Historical native PostgreSQL 18.4 verification passed 19 scenarios, including repeat migration through 007 and the exact requested JSON→XML fixture sent to a real local HTTP receiver. Disposable compiled-runtime startup, health/readiness, metrics authorization and active-work SIGTERM also passed then. The development `MiniMirthDev` upgrade reached schema 1–7 with unchanged business counts at that time. **Migration 008 and current native PostgreSQL tests have not been applied/run against that database or any production database in this session.**

## Browser session policy — 21 October 2026

The browser console uses short access JWTs with a database-backed family and rotated refresh-token hashes. Defaults are:

| Variable | Default | Effect |
| --- | --- | --- |
| `UI_ACCESS_TOKEN_SECONDS` | 300 | Memory-only browser access token; automation uses its separate `JWT_EXPIRES_IN` |
| `REFRESH_TOKEN_SECONDS` | 28800 | Refresh lifetime ceiling; a legacy 604800 override is still capped by the absolute policy |
| `SESSION_ABSOLUTE_SECONDS` | 28800 | At most eight hours since login; refresh and activity cannot move it |
| `SESSION_IDLE_SECONDS` | 900 | Fifteen minutes without an authenticated explicit user-activity signal |
| `SESSION_WARNING_SECONDS` | 60 | Warning countdown before the effective deadline |

The effective absolute duration is the smaller refresh/absolute setting. Configuration requires access lifetime ≤ idle lifetime ≤ effective absolute lifetime and warning < idle. The absolute setting cannot exceed 28800 seconds. Tighter policy applies to existing new-style families on their next request, without moving their stored login time. These defaults are an application policy, not a claim of a specific compliance level.

`BrowserSessionFamilies` stores original creation time, fixed expiry, last activity and revocation; `BrowserSessions` retains the rotated token hashes linked by FK. Every browser-authenticated request checks expiry/revocation under the family lock. Background `/auth/me`, polling and token refresh do not touch last activity. `POST /api/auth/browser/activity` requires browser Bearer identity, matching current refresh-cookie family and CSRF, then uses server time to move only idle expiry. This signal does not prove physical presence cryptographically: a holder of valid credentials/session can send requests. Absolute expiry remains the hard cap. Expired families cannot be revived; policy revocation and one expiry audit commit before the 401 response. Database/audit failures fail closed.

Login/refresh and `/auth/me` return top-level `session` metadata: `idleTimeoutSeconds`, `warningSeconds`, `idleExpiresAt`, `absoluteExpiresAt`, `serverTime`. The UI uses the server clock with monotonic elapsed time, checks resume/focus and displays a one-minute warning with **Continue session** / **Sign out**. Trusted pointer/keyboard/scroll interactions send throttled activity; merely opening/focusing a tab or receiving a response does not. The warning requires an explicit Continue choice. Cookie Max-Age is the remaining absolute lifetime; refresh does not reset it to a new full eight hours. HttpOnly, scoped path, production Secure, SameSite=Strict, CSRF, rotation/reuse detection and current-role lookup remain enforced.

Logout immediately clears sensitive UI, serializes against pending refresh/login/activity, then revokes family and rotated tokens on the server. Generation checks ignore late refresh/login responses and stale 401 responses from an older login. Shared Web Locks serialize rotation/activity across tabs; a local promise queue protects one tab when Web Locks are unavailable. A nonsecret browser logout-intent marker, cookie fallback and cross-tab notifications prevent automatic restoration while revocation is pending/failed. Automatic restoration requires writable localStorage; otherwise explicit login is required, so disabled storage does not silently restore a cookie session after reload. A failure displays **Sign out could not be confirmed** and **Retry sign out** instead of claiming success. Offline clients cannot force a server transaction; idle/absolute enforcement remains authoritative. Browser close events are not a security boundary. No access/refresh token or payload is stored/broadcast in these markers. Cross-tab browsers without Web Locks may fail closed on a conflicting refresh replay; this does not authorize reuse.

Migration **008** preserves data/history but intentionally revokes all pre-policy browser sessions once. Repeat migration is a no-op for fresh families. Rollout must use matching backend/frontend, schema 1–8, the existing keyring and deployment-owned environment. Review preflight, verify backup, run the complete migration, build, restart and require users to sign in again. This session changes source/config examples only, not remote environment/database. Run the extended suite in disposable PostgreSQL before deploying. Legacy Bearer automation and channel API keys have separate authentication and are not browser idle heartbeats.

Prefer rolling back channel/application configuration on the current guarded binary. An older authentication artifact does not enforce this policy; binary downgrade needs explicit security review and browser family revocation. Keep migration 008/table/history, backups and keys. Never restore old session rows to revive a user's login. General principles: [OWASP server-side idle/absolute timeouts](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration), [NIST session reauthentication](https://pages.nist.gov/800-63-4/sp800-63b/session/).

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

## Destination preparation, filtering and resend

`Destination enabled` controls whether a connector participates in processing. Disabled destinations run no filter, transformation, template or request, and create no outbound job. `Enable destination filter` independently controls a retained condition on an enabled destination. Turning the filter off preserves its exact rule and bypasses it. Turning it on evaluates against an independent clone of the source-processed message, before destination transformation. A mismatch marks only that destination FILTERED and causes no network attempt or retry. Source validation and source filtering retain their earlier channel-wide positions.

The destination pipeline is filter → transformer → optional existing template script → outbound conversion → protected sender. Templates execute in the same sandbox against the transformer output and can replace the outbound body; they are not saved-template selections. Legacy Boolean/script filters, mappings and templates remain stored. A legacy false filter continues to skip delivery. Changing a configuration in the wizard still creates a draft and requires publish before it affects new messages.

Outbound rows initially have no transport snapshot. Successful preparation saves the final serialized body and encrypted connector snapshot together under the lease; new snapshots carry `preparation_version:1`. Filter mismatches and preparation errors retain no runnable snapshot. They create no `MessageDestinationLog` transport attempt, delivery slot or automatic retry. Preparation errors remain OUT-ERROR with a safe stage/code so an operator can distinguish filter, transformation, template and conversion failures. Fix the configuration and review the original inbound message before deciding whether to submit a new message; an unprepared body must not be sent through manual resend.

Automatic retry and `POST /api/message/resend/:id` verify the saved final body before use and never repeat preparation. Missing or unproven historical preparation returns `DESTINATION_NOT_PREPARED`; unreadable connector data returns `INVALID_DELIVERY_SNAPSHOT`. Old queued deliveries or captured transport/admission evidence can verify legacy preparation. An encrypted connector from an old failure alone is insufficient. Operators must reconcile ambiguous historical outcomes rather than bypass the guard. Use an artifact carrying this guard for retry/resend of these records; an older binary may lack it.

Permanent HTTP 4xx responses other than 408/429 stop automatic retry with OUT-ERROR. HTTP 408/429 and 5xx continue through the configured bounded retry policy; max retries, interval, timeout and circuit defaults are unchanged. Ambiguous transport outcomes, including timeouts, remain DEAD_LETTER without automatic retry. Manual resend still requires the existing permission, a running channel, an enabled/non-retired destination and receiver reconciliation.

Review & Test uses the same preparation pipeline without DNS, sockets, message-history writes or retry jobs. Per-destination `enabled`, `stages` and `delivery` distinguish DISABLED, SOURCE_FILTERED, FILTERED, NOT_SENT and NOT_SENT_ERROR. A filtered or disabled destination reports its later stages as not run; a successful dry-run never claims HTTP acceptance.

## Mapping, field discovery and HL7 presets

Visual V2 mappings remain in the existing processing-script fields and encrypted revisions. V1 scripts are preserved. Altered or noncanonical reserved V2 metadata/body fails closed with `FIELD_MAPPING_CONFIG_INVALID` before sandbox execution or delivery; restore/recompile the mapping or replace it with a complete custom transformation script. A missing/null/empty-string source value first uses its configured default; if still empty, a required row fails and an absent optional row is omitted. Zero and false remain present. Explicit conversions support TEXT, NUMBER, BOOLEAN, DATE_TO_HL7 (`YYYY-MM-DD` → `YYYYMMDD`) and DATE_FROM_HL7 (the reverse), with real calendar checks and no guessed locale/date format. JSON/XML source paths use own-property dotted paths and zero-based indexes; XML attributes use `$` (for example `Patient.$.origin`). HL7 paths accept `PID-5.1` or `PID.5.1`; repeated source segments/fields use explicit indexes such as `OBX.1.5` or `PID.3.0.1`. Paths refer to the actual parsed structure, so a path for a single segment must be adjusted when that segment repeats; the mapper does not implicitly select its first occurrence.

`POST /api/channel/discover-fields` requires ADMIN/DEVELOPER `channel:write` and the existing authentication/management limits. Request `{format,payload,processingScript?}` uses JSON/XML/HL7V2/TEXT and a synthetic sample; optional source transformation uses the existing sandbox. The response returns `fields` and `processedFields`, limited to 512 nodes and 12 levels each, without values. Unsupported/prototype property names cannot become selected mapping paths. The metadata-only audit `DISCOVER_MESSAGE_FIELDS` must succeed before the result is returned. Discovery performs no DNS, connection probe, delivery, message-history write or channel save, and does not run a stored facility validation profile or source filter.

Review returns `parsedInput` for XML/HL7 samples with its complete payload set to `[REDACTED]` by default; only an explicit ADMIN raw request, audited before response, receives parsed values. Numeric HL7/XML paths therefore cannot expose patient identifiers or measurements through generic JSON masking. Routed HL7 outputs also provide a metadata-only `fieldTree`. These are transformation previews, not live delivery tests. No credential environment variables are read to authenticate an outbound request during dry-run.

The supported visual HL7 generation presets are deliberately narrower than full HL7 conformance:

| v2.5 preset | Generated segment family | Selected rules |
| --- | --- | --- |
| ADT^A04 / ADT^A01 | MSH, EVN, PID, PV1 | PID-3/PID-5 required; header/event timestamps and codes checked; default patient class O/I respectively |
| ORU^R01 | MSH, PID, PV1, OBR, OBX | One order; OBR-4 and a placer/filler order ID required; 1–100 observations with OBX-3/OBX-5; ST/TX/NM values and selected result-status codes |
| ORM^O01 | MSH, PID, PV1, ORC, OBR | One order; OBR-4 plus consistent ORC-2/OBR-2; new-order control NW |

All presets check PID identifiers/name, supported administrative sex/patient class, calendar birth date if present, message timestamp and control ID. MSH-1/2/9/11/12 come from header configuration; absent message time/control ID use a generated UTC timestamp with `+0000` and a generated ID. Literal timestamps accept calendar-valid `YYYYMMDDHHmmss` with optional `±HHMM`; the offset magnitude cannot exceed 14:00, minutes cannot exceed 59 and 14 hours requires 00 minutes. Without an offset, the timestamp means sender-local time, per the [HL7 v2.5 DTM/TS definitions](https://www.hl7.eu/HL7v2x/v25/std25/ch02A.html). Partial dates and fractional seconds are not supported by this visual configuration. ADT MSH-9 includes `ADT_A01` as its structure component. Output OBX repetitions use explicit `OBX[0].5`-style targets; only supported fields and segment families appear in the selector. This does not validate all optional segments, grouping/cardinality rules, vocabularies or hospital-specific profiles. References: HL7 International [message maps](https://hl7.org/fhir/uv/v2mappings/STU1/message_maps.html) and [table 0001](https://hl7.org/fhir/R4/v2/0001/index.html). Hospital UAT remains necessary.

## HTTP sender settings and credential slots

`deliveryPolicy.http` stores method POST/PUT/PATCH, format-compatible Content-Type, authentication NONE/BEARER/BASIC and up to ten `{name,slot}` custom header references. JSON uses `application/json`; XML supports `application/xml` or `text/xml`; HL7 supports `application/hl7-v2` or `text/plain`; plain text uses `text/plain`. Managed routing, framing, authorization, cookie and correlation headers cannot be replaced by custom header entries. Header names are unique ignoring case; slot names start with an uppercase letter and use at most 40 uppercase letters, digits and underscores.

Values are deployment environment secrets, never wizard fields or exported configuration values. For destination ID `2`, Bearer uses `MIRTH_DESTINATION_2_BEARER_TOKEN`; Basic uses `MIRTH_DESTINATION_2_BASIC_USERNAME` and `MIRTH_DESTINATION_2_BASIC_PASSWORD`; `{name:"X-Vendor-Key",slot:"VENDOR_KEY"}` uses `MIRTH_DESTINATION_2_VENDOR_KEY`. The namespace uses the actual stored destination ID, not its name or array index. A duplicated/imported channel receives new destination IDs and needs separately provisioned credentials. Resolve those IDs after saving and provision secrets through the protected runtime environment/mounts, then restart. Do not put secret values in CLI history, YAML, screenshots or frontend code.

Explicit Bearer/Basic configuration overrides legacy URL userinfo. NONE preserves legacy URL Basic behavior for compatibility; prefer environment slots when updating a connector. Missing/empty/oversized credentials or CR/LF/NUL characters produce DESTINATION_CREDENTIAL_MISSING without making an HTTP request or automatically retrying. HTTP_CONFIG_INVALID similarly rejects local configuration. These retained diagnostic events are DELIVERY_REJECTION, with no network attempt, HTTP status, transport duration or sent timestamp. Real destination responses continue to use the normal captured HTTP status/duration contract.

No schema migration is added for mapping/HL7 metadata or HTTP settings: scripts and delivery-policy JSON retain them in existing tables and encrypted snapshots. Existing filters, API keys, redaction, RBAC and audit remain enforced. Before application downgrade, publish a compatible V1 or custom-script revision: older binaries cannot interpret the V2 result envelope and may ignore HTTP policy fields. Preserve the database, audit evidence and encryption keyring, and use an artifact carrying the preparation guard for retry/resend; an older binary must not resend unprepared work.

## XML rules

Legacy Basic validation stores `validationProfile.basicSyntax=true` and follows the inbound JSON/XML/HL7 format. New configurations use versioned NONE/FIELDS/CUSTOM modes with retained inactive settings. JSON field rules validate incoming fields before source selection/transformation and fail with FIELD_VALIDATION_FAILED/IN-ERROR without delivery jobs or retries; see [manual 8.3](MIRTH_LITE_UI.md#83-message-validation). Field rules are JSON-only; XML/HL7 use the bounded profiles below. JSON is parsed once at ingress or in the preview editor, preserving valid JSON scalar strings. Existing JSON-object-only presets remain unchanged; custom schemas/rules/scripts remain advanced options. Mapping required/default fields are enforced during transformation after source selection.

Source and destination simple filters compile Field/Operator/Value into their existing sandboxed `filterScript`, with canonical metadata for reopening the builder. Text comparisons operate on scalar values, numeric comparisons require finite numbers, and missing values do not satisfy comparisons, including not-equal. Presence checks distinguish missing paths from existing null/empty fields. Paths reject prototype access and values remain data. Intact generated XML filters/mappings use bounded parsing; arbitrary legacy scripts retain their original input. No additional engine stage or database column is introduced for either feature.

`validationProfile.xml` supports a literal root name, up to 50 required nonempty text-element paths and up to 50 allowed-text-value rules. Example synthetic configuration:

```json
{"xml":{"root":"Order","requiredPaths":["Order.ID"],"values":[{"path":"Order.Status","allowed":["NEW","UPDATED"]}]}}
```

Paths are dotted literal element names, including literal namespace prefixes; they are not XPath or namespace-URI expansion. Repeated matched values must all satisfy allowed values. Attributes and complex XSD are not supported. XML2JS strict parsing rejects malformed documents, DOCTYPE/entities, configured byte-limit violations, more than 20,000 nodes, and depth above 64. Error messages contain no XML values. XML/text viewer masking remains full redaction. Hospital-specific profile selection and UAT remain required.

The same bounded parsing also protects outbound XML and XML-to-JSON conversion. A script returning malformed XML or an entity declaration fails during destination conversion before the sender runs. JSON-to-XML mappings are converted before the final body/snapshot is saved; HTTP Content-Type follows that destination's selected output format.

## Metrics and diagnostics

`/metrics` remains ADMIN-authenticated and blocked at the public proxy. Added series include database pool total/idle/waiting, active delivery/script/inbound/retry workers, source/delivery lease recoveries, script timeout/memory failure, login failure, authentication/management rate-limit rejection, idempotency expiry/hit/conflict and counts by the four fixed channel states. MLLP active connections use a gauge, not a decrementing counter. No patient/channel-name/request-ID metric labels are accepted. Runtime counters/histograms reset per process; SQL gauges describe retained records. HA scrape/aggregation and load must be verified externally.

`GET /api/system/configuration` returns effective deployment-owned settings to ADMIN only. It does not expose keys, URLs, database credentials, certificate file paths or session token hashes. `GET /api/system/diagnostics` audits an ADMIN export of schema versions, aggregate counts, safe settings and process/pool metrics with `Cache-Control: no-store`. It excludes payloads, scripts, credentials, endpoints, clinical identifiers, logs and free-text notes. This is a metadata artifact, not a complete incident archive. Settings remain read-only until a reviewed mutable configuration design exists.

Message delivery detail reports actual HTTP status and `durationMs` from the captured transport attempt, excluding database work and response scripting. `attemptCount` uses complete saved transport history; known non-network filtering/preparation/admission events do not count as attempts, while ambiguous historical events remain unknown. No synthetic 200, inferred duration or guessed attempt count is displayed.

`GET /api/message/:id` adds `destinationOutcomes`, a maximum of 50 safe stage summaries separate from paginated delivery logs. They use the immutable connector/channel revision when available, including disabled destinations without an outbound job; missing historical evidence is UNKNOWN. Each outcome includes enabled, filter, transformation, template, conversion, delivery and an attempt count, with optional safe code, timestamp and network-attempt flag. Existing logs add `eventKind`, `networkAttempted` and `occurredAt`; `sentAt` appears only when a real network event was recorded. ADMISSION_WAIT is distinct from DELIVERY_ATTEMPT. Existing payload permissions, redaction, raw-access audit and sanitized exports remain enforced.

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

Known pre-network INVALID_ENDPOINT / DESTINATION_HOST_DENIED / DESTINATION_ADDRESS_DENIED / HTTP_CONFIG_INVALID / DESTINATION_CREDENTIAL_MISSING rejections are terminal without automatic retry and expose DELIVERY_REJECTION with networkAttempted=false and no transport duration. Recorded HTTP/ACK evidence remains a real attempt; an actual HTTP response body equal to a diagnostic string is not misclassified. Historical timing values are not rewritten in storage.
