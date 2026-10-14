# Development database reset — 14 October 2026 (Asia/Jakarta)

## Authorization and result

The user explicitly confirmed resetting the configured remote **MiniMirthDev**, schema **public**, after backup, and selected **admin@gmail.com** as the only retained ADMIN. The host and full backup receipt remain in the private local backup directory. This was a development database operation, not a production deployment or certification.

The reset committed successfully. Schema versions are now **1, 2, 3, 4, 5**. The original administrator ID **3**, username, name, role, password hash and timestamps were preserved exactly; no default password was introduced. Users `admin` and `maria` were removed as requested. Business/configuration/history/session/alert records were emptied. `SchemaMigrations` retains five technical version markers so startup/migration remains valid. Revocation records are retained by the utility to avoid resurrecting revoked bearer tokens; this database had zero such records.

| Table | Before | After |
| --- | --- | --- |
| Users | 3 | 1 |
| Channels | 16 | 0 |
| AuditLog | 14 | 0 |
| Destinations | 0 | 0 |
| Messages | 0 | 0 |
| MessageDestinationLog | 0 | 0 |
| SchemaMigrations | 1 | 5 |
| BrowserSessions / ChannelRevisions / DeadLetterCases | not present | 0 each |
| DestinationRuntime / DeliverySlots / OperationalAlerts | not present | 0 each |
| RevokedTokens | 0 | 0 |

## Backup and rehearsal

Private backup directory: `backups/development-reset-2026-10-14T15-11-42-730Z/`.

Files: AES-256-GCM encrypted `.dump.enc`, checksum/authentication manifest `.dump.enc.json`, `recovery.key`, `receipt.json`, and `reset-result.json`. Directory mode is 700 and private files mode 600; all are ignored by Git. No password, key, plaintext dump, payload or stored password hash is written to this report. Retain the archive, manifest, recovery key, receipt and original configuration keyring for recovery; store recovery material under the owner's backup/secret policy.

Backup used an exported PostgreSQL snapshot under shared maintenance locks. The encrypted archive was decrypted/checksummed/authenticated and restored into an empty local disposable database. Restored counts and fixed-size digests for every original application table matched the source snapshot. Ten native rehearsal checks passed: missing account rejection; cross-schema cascading dependency rejection; future-version rejection; active-work protection; injected failure after TRUNCATE with full data/schema rollback; source-change detection; full migration/reset; repeated migration/reset; synthetic browser/password login and retained ADMIN authentication; health/readiness. The synthetic login/session/audit was removed from the rehearsal database and was never created remotely.

The actual reset acquired exclusive locks, required the exact configured host/database, rechecked the source fingerprints against the verified backup, verified the encrypted backup again, and migrated/cleared records in one transaction. No TRUNCATE CASCADE, schema drop, production restore, or remote process termination was used. Existing external dependencies/custom triggers refuse the operation.

## Verified commands

| Command / check | Actual result |
| --- | --- |
| npm ci --no-audit --no-fund | PASS, 423 packages; existing install-script policy warnings |
| db:reset-development --dry-run before change | PASS: schema 1, 3 users, 16 channels, 14 audit records |
| db:reset-development --prepare-backup with exact target confirmations | PASS: encrypted consistent snapshot and private receipt/key |
| db:restore into local mirth_disposable_reset_restore_20261014 | PASS: pg_restore of decrypted/checksummed archive |
| verify-development-reset.ts on restored local database | PASS: 10 native checks; receipt marked restoreVerified |
| first actual reset attempt | FAIL: RESET_FAILED before commit; read-only check confirmed schema 1/counts unchanged; exact initial error cause was not captured and remains unconfirmed |
| retry after adding safe stage/error diagnostics | PASS: COMMITTED, schema 5, one ADMIN, all operational rows zero |
| db:reset-development --dry-run after commit | PASS: final counts above |
| Actual backend API against reset database | PASS: /health, /ready, /api/auth/me, /api/channel, /api/message/stats and /metrics all HTTP 200; channel array empty |
| Wrong target and conflicting CLI modes | PASS negative checks: exit 1 with EXACT_RESET_TARGET_CONFIRMATION_REQUIRED / CONFLICTING_RESET_MODES before connecting |
| npm run typecheck / lint / format:check | PASS |
| npm run test:coverage | PASS: 238 tests, 19 suites; statements 78.54%, branches 71.51%, functions 80.69%, lines 79.72% |

The initial module probe also failed because dotenv is installed in the server workspace, not at the repository root. Using createRequire relative to server/package.json resolved the probe; no database writes occurred. The first reset failure was rolled back; no cause is invented. Additional stage diagnostics and commit-outcome tracking now distinguish failure before commit, uncertain commit, and report-writing failure after a successful commit. The actual retained-account password was not requested or tested; exact hash preservation and ADMIN authentication were verified, and a synthetic password/browser login was verified only on the disposable restore.

## Guarded utilities

`npm run db:reset-development` defaults to preview. It refuses production configuration, unexpected schemas/tables, external cascading references/custom triggers, future migration versions and oversized development datasets. Backup and execution require exact host/database confirmation. Execution additionally requires a verified matching receipt, unchanged source digests, an existing bcrypt ADMIN and no active processing. Operational identity sequences restart; the user identity sequence is preserved to avoid reissuing deleted user IDs.

For another development reset, prepare a new backup, restore it into a new empty local `mirth_disposable_*` target, and run:

```sh
RESET_VERIFY_DATABASE_URL=<local-disposable-url> npm run db:verify-development-reset -- --receipt <private-receipt-file> --keep-user <existing-admin>
```

The URL and paths are placeholders. Do not run verification against the source/remote database. Reusing the old reset receipt for a later changed source is refused. Recovery starts by restoring the archive into a separate empty disposable target with `db:restore`; do not overwrite the current remote database automatically. Review the restored copy and choose an owner-approved recovery procedure. Normal login/operations will create new audit/session rows after this empty baseline.
