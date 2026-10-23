# Backup and restore

Run maintenance tools from a trusted Node/npm checkout with PostgreSQL `pg_dump`/`pg_restore` on PATH. Set explicit BACKUP_DATABASE_URL through protected environment/secret injection; the CLI does not default to application's `.env` database. Use libpq PGSSLMODE=verify-full and PGSSLROOTCERT for external PostgreSQL. Passwords are passed to child environment, not command arguments or console. Never paste a credential in shell history.

Set BACKUP_ENCRYPTION_KEY_FILE to an access-controlled 64-hex independent backup key. BACKUP_DIRECTORY must be protected storage. Backups are streamed from PostgreSQL custom archives into AES-256-GCM encrypted files with timestamp, checksum and authentication manifest. Temporary plaintext is restricted to an owner-only directory and removed in finally. Files use mode 0600 and directory 0700. If interrupted forcibly, inspect and securely remove abandoned `/tmp/mirth-backup-*`/`mirth-restore-*` files. A failed creation may leave an incomplete encrypted artifact; do not treat it as a valid backup.

```sh
npm run db:backup
npm run db:restore -- --file /secure/path/backup.dump.enc
npm run db:verify-restore -- --file /secure/path/backup.dump.enc
```

Restore requires BACKUP_DATABASE_URL selecting an EMPTY local `mirth_disposable_*` database, RESTORE_DISPOSABLE_CONFIRMED=true, and trusted backup provenance. Remote and production targets are rejected unconditionally. It validates checksum/GCM then uses pg_restore single-transaction, exit-on-error, without clean/drop. Verification checks schema versions, user/channel/destination/audit/message counts, encryption readability and message linkage, adds a synthetic VIEWER and tests login/health/readiness against that disposable target. Set BACKUP_SCHEMA and the correct application encryption keyring for the restored schema. Counts are taken before adding the synthetic verification user. Never promote this test database directly to production.

The current runtime and verifier require schema versions **1–8**. For trusted older backups, restore to an empty disposable database using the corresponding compatible artifact, apply the complete migration chain **001–008** with an explicitly isolated environment and the original application keyring, then run current verification. Keep the original backup unchanged. Migration 006/007 adds nullable HTTP status/duration. Migration 008 adds browser session families and intentionally revokes pre-policy sessions once, retaining user/message/token history. Restored browser sessions must not be treated as active identities. See [upgrade compatibility](MIRTH_LITE_UI.md#database-upgrade-dan-compatibility) and [session policy](OPERATIONAL_CONTROLS.md#browser-session-policy--21-october-2026).

The latest native PostgreSQL 18.4 run passed 19 integration scenarios through schema 7, including repeat migrations and the requested real local JSON→XML delivery; compiled startup, health/readiness, protected metrics and SIGTERM during active work also passed. A fresh native schema-7 backup/restore drill remains **NOT TESTED** because `pg_dump`/`pg_restore` clients were unavailable. Unit/process utility tests and migration checks do not replace that drill. See [the latest verification record](MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi).

Production restore is deliberately operator-controlled through the DR plan, outside this utility. Retention deletion of backups is NOT IMPLEMENTED to avoid silently deleting required recovery evidence. Configure approved encrypted object-storage lifecycle policies only after RPO/retention/legal-hold ownership is agreed. Backup storage, offsite replication, key recovery and full pg_dump/restore drill remain RUNTIME VERIFICATION REQUIRED unless the report records the completed synthetic drill; production/offsite/DR verification remains required.

Reference: [PostgreSQL pg_restore single transaction](https://www.postgresql.org/docs/current/app-pgrestore.html).

A prior local synthetic drill for the earlier schema used PostgreSQL 18.4 clients built in /tmp without TLS support; that historical result does not certify a schema-7 restore. Those binaries are not shipped as production tools. Production backup clients must support verified TLS. Proxy example uses the official unprivileged NGINX image; ensure the certificate/private-key mount is readable only by the configured proxy UID/group, never world-readable. [NGINX unprivileged image reference](https://github.com/nginx/docker-nginx-unprivileged).

Application rollback preserves schema versions, all rows and the compatible keyring; do not drop additive columns or restore an old backup over current data. Publish a revision compatible with the older artifact before a binary downgrade, especially when generated XML simple conditions depend on the new normalizer. Production restoration remains the separate operator-controlled DR procedure above.
