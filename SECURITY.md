# Security policy

Report vulnerabilities privately through the repository owner's approved channel or GitHub private vulnerability reporting if enabled. No contact is invented here; the owner must configure one. Do not include patient payloads, credentials, private keys or raw database dumps in public issues. Provide affected commit, synthetic reproduction and safe diagnostic codes. Rotate exposed credentials before considering historical cleanup. This custom engine has no formal HIPAA/ISO/SATUSEHAT certification claim. Production deployment requires hospital UAT, independent review and the readiness matrix.

## Security verification — 16 October 2026

Development working tree based on `ce6db8d`. UI simplification retains all four roles and backend permission checks. No database, account, environment secret or production configuration was changed in this review. **This is not a production-security certification.** PASS below means the named local test/source check passed; it does not certify every possible attack or an external deployment. API tests use mocked database adapters; browser tests use intercepted synthetic API responses. No live patient data is used.

| Control | Local result | Evidence and limits |
| --- | --- | --- |
| Authentication | PASS | `auth-api.test.ts`: missing/invalid/expired JWT, issuer/audience/expiration checks, database role refresh; `security-regression.test.ts`: logout then revoked-token rejection |
| RBAC / permission checks | PASS | Viewer/Operator/Developer raw-access denial; Operator denied user management and API-key rotation; existing publish/rollback/reconciliation negative tests and browser role visibility |
| Source API key | PASS | Missing/invalid key rejected before processor; production rejects development global-key fallback; management bearer compatibility retains `inbound:send` checks |
| API-key rotation | PASS | Generated replacement stored encrypted; old key rejected at both inbound paths; new key accepted; rotation audit emitted |
| One-time API-key display | PASS | Rotation response is `no-store`; channel list exposes only configured flag; browser closes/reopens without retaining the key; no retrieval API |
| Audit logging | PASS | Rotation/raw-access/logout metadata assertions; raw response fails closed when audit insert fails. Durable database behavior is not rerun here |
| Payload redaction | PASS | JSON/HL7/free-text/XML masking tests; default message/preview payload masked; synthetic names/MRN/passwords/tokens excluded. Arbitrary hospital profiles still require review |
| Audited raw-payload access | PASS | Requires `message:raw`; default remains masked even for ADMIN; explicit access emits `VIEW_MESSAGE_RAW` with request ID before response |
| Configuration secret encryption | PASS | AES-GCM roundtrip, tamper rejection, historical ciphertext/keyring tests, rotation tests, encrypted source credential storage and sanitized endpoints/revision details |
| SSRF / destination host protection | PASS | Literal and DNS loopback/private denied without explicit allowlist; metadata/link-local/unspecified/multicast always denied; IPv4-mapped IPv6 cases, pinned DNS answer, real HTTP redirect rejection; existing TCP/TLS probes share policy |
| Rate limiting / brute force | PASS | Actual repeated wrong-password login reaches 429; invalid source keys limited before more DB lookups; management limiter retained. Limits are per process/IP, not a distributed defense |
| Secure script sandbox | PASS | QuickJS tests: no host process/filesystem/network/constructor escape, infinite-loop timeout, memory limit, isolation and sanitized script failures |
| Safe error responses | PASS | Tested failures contain safe code/message/requestId/details; SQL/internal exceptions withheld. Legacy authenticated success/processing result contracts remain compatible |
| Request size limits | PASS | HTTP oversized request rejected with 413; sandbox input/output and transport response bounds retained |
| Correlation IDs | PASS | Server-generated UUID on HTTP responses, passed to processor and audit; existing accepted-work metadata tests retained |
| Idempotency protection | PASS | Unit tests cover hash/canonical identity, duplicate reuse, conflict and required mode; existing channel policy preserved. Fresh PostgreSQL concurrency verification: NOT TESTED |
| Secure logging | PASS | Actual Pino stream test excludes synthetic patient, password, API-key header and Error text; metadata allowlist retained; source credential header never passed to message processor |
| Secrets/environment and frontend boundary | PASS | Server environment config retained; source review found no `VITE_*` secret usage; targeted source secret scan has no findings. This is not a general proof against arbitrary secrets embedded in custom scripts |
| Missing/insecure production secrets | PASS | Startup config rejects missing secrets and obvious placeholder/repetitive current keys; production HTTPS base URL, verified PostgreSQL TLS and outbound allowlist requirements retained. Placeholder rejection is not an entropy guarantee |
| Dependency scanning | PASS | `npm audit --audit-level=high --json`: 0 vulnerabilities across all severities; CI audit step retained |
| Current source targeted secret scan | PASS | `npm run secrets:scan`: no findings; scanner deliberately excludes ignored environment/backup files |
| Public HTTPS and protected backend port 9000 | NOT TESTED | Production example publishes only proxy 443, backend uses internal `expose`, nginx TLS/HSTS and private metrics. Actual domain, TLS chain, firewall and direct-port reachability require deployed verification |
| Deployed PostgreSQL TLS / MLLP TLS and secret custody | NOT TESTED | Local configuration/certificate tests pass; actual infrastructure certificates, renewal, environment injection and encryption-key custody not verified |
| CI dependency/secret scanning execution | NOT TESTED | CI definitions contain npm audit and redacted Gitleaks; remote workflow execution was not observed. Gitleaks binary unavailable locally |
| History scan and historical credential revocation | NOT TESTED | No fresh full-history scan or credential-owner confirmation. See [rotation](docs/SECRET_ROTATION_RUNBOOK.md) and [history cleanup](docs/GIT_HISTORY_CLEANUP_RUNBOOK.md); no history rewrite performed |
| Production log/PHI leakage verification | NOT TESTED | Local synthetic assertions pass; deployment collectors, proxy logs, legacy database history and hospital payload profiles have not been inspected |

## Changes and compatibility

- Keep the Source → Transformation → Destinations → Review UI and existing engine/security capabilities. No security settings need to become visible in the ordinary wizard.
- Require explicit `OUTBOUND_ALLOWED_HOSTS` entries for intended private/loopback destinations, including development. Public production destinations already require exact entries. Hostname entries authorize that host's private DNS answers; treat this as a reviewed network exception, backed by egress firewall rules. Prohibited metadata/link-local/unspecified/multicast addresses cannot be opted into. Credentials, retries, connection probes and accepted-work snapshots continue using the same shared transport policy.
- Add a per-IP/process limiter on source API-key requests: 60 unsuccessful responses per minute, HTTP 429 with `Retry-After`; successful completed responses do not consume the failure budget. In-flight requests temporarily count. Channel 4xx/5xx processing failures also consume this budget. Existing auth limit is 20/minute and management limit 300/minute. Multi-instance deployments require shared gateway/distributed controls and load testing; a shared NAT can share the failure budget.
- Reject obvious example/test/repetitive current JWT/encryption keys only at production configuration loading. Existing development/test fixtures remain supported. Provision fresh independent random keys through environment/secret mounts; use the rotation runbook/keyring for encryption changes, never replace a live encryption key without retaining decryption/recovery capability.
- Preserve legacy bearer automation and stored configuration; source keys stay out of list responses and audit detail. Rotation is immediate: clients using the previous key must update. Arbitrary existing user-authored scripts can still contain credentials and must be reviewed/redesigned by their owner; never display them to Viewer/Operator or add them to reports/logs.

## Executed verification

| Command | Result |
| --- | --- |
| `npx vitest run server/test/security-regression.test.ts server/test/transport-security.test.ts server/test/usability-api.test.ts server/test/auth-api.test.ts` | Initial FAIL: sandbox `listen EPERM` (44 failures, 32 passes plus one socket error). Rerun with loopback permission: PASS 76/76 at that intermediate revision |
| `npm run test:coverage` | PASS final 380 tests / 30 suites; statements 82.99%, branches 79.73%, functions 85.24%, lines 83.96%. Previous baseline: 82.09% / 78.80% / 83.84% / 83.12% |
| `npm run test:e2e` | PASS 57/57 synthetic browser scenarios, including one-time key lifecycle, role changes and raw-view controls |
| `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` | PASS client/server checks and builds |
| `npm run docs:check` | PASS structural OpenAPI check, 46 paths / 50 operations; semantic review remains required |
| `npm run secrets:scan` | PASS, targeted scanner findings empty |
| `npm audit --audit-level=high --json` | PASS, 0 vulnerabilities; machine report saved locally in `/tmp/mirth-security-audit-2026-10-16.json` |
| `git diff --check` | PASS |
| Fresh `npm ci`, PostgreSQL integration/concurrency, Docker startup, deployed HTTPS/firewall, full Gitleaks/history scan, remote CI, load/security review, hospital UAT and DR drill | NOT TESTED in this review |

Final coverage output is also retained locally in `/tmp/mirth-security-coverage-2026-10-16.log`; temporary files are local evidence, not repository artifacts. Before deployment, complete the [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md), verify the HTTPS-only public entry point and blocked direct backend port, review exact hospital destination allowlists/redaction profiles, configure shared rate limiting, verify secret rotation and run the PostgreSQL/concurrency and operational drills on disposable/staging infrastructure.
