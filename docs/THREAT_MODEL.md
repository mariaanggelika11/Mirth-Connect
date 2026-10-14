# Threat model

Assets: payloads, routing scripts, endpoint credentials, signing/encryption keys, administrator privileges, durable message/attempt records, audit/revision history and backups.

Trust boundaries: browser ↔ HTTPS proxy ↔ Express; external hospital sender ↔ authenticated HTTP or isolated/TLS MLLP; runtime ↔ verified PostgreSQL TLS; interpreter ↔ host; connector ↔ allowlisted destination; CI ↔ source/dependencies; operations ↔ encrypted backup storage.

| Threat | Control | Residual risk |
| --- | --- | --- |
| XSS steals permanent JWT | memory-only browser access, short expiry, CSP, HttpOnly rotating refresh | compromised page can act while open; independent security review needed |
| Refresh replay / CSRF | hashed tokens, family advisory lock, committed family revocation, Strict cookies, CSRF token | Web Locks serialize refresh across supported-browser tabs; unsupported browsers need session/tab review |
| Stale role or revoked session | database role/session read per API request | existing Bearer automation expiry remains configurable |
| SSRF / metadata / rebinding | host allowlist, DNS address validation and pinned lookup, no redirects/environment proxy | IP/network policy must be reviewed for each hospital |
| PHI disclosure | metadata-only list/log records, conservative viewer masking, admin-only audited raw access | organization must configure JSON/HL7 paths; raw backups remain sensitive |
| Message duplicate | reservation/unique dedupe/advisory locks, stable outbound idempotency, ambiguous outcome dead letter | no cross-system exactly-once guarantee; remote 5xx can follow acceptance |
| Stale worker overwrite | lease owner checked on result write, durable attempt transaction | network side effect cannot be fenced after remote acceptance |
| Config race | draft/publish conflict check and channel locks; connector snapshots | external sources must tolerate controlled status transitions |
| Script denial of service | QuickJS isolation, bounded concurrency/time/memory | capacity/load testing still required |
| Secret history compromise | targeted history report, Gitleaks CI, rotation/rewrite runbooks | historical credentials remain rotation-unverified |
| Restore overwrites production | explicit target, loopback + disposable name, confirmation + empty target | trusted archive may execute SQL; operators must validate archive provenance |

MLLP without TLS is restricted to an explicitly approved isolated network. Native TLS/mTLS verifies peer certificate/hostname through Node TLS. Production exposure, certificate renewal and expiry drills remain runtime work.

Script authors/publishers are trusted clinical payload processors. UI masking is not a security boundary against an authorized author who can transform or encode raw input; publish permissions and independent configuration review must reflect that trust. Raw payload storage relies on database/storage access controls and owner-provisioned at-rest protection.
