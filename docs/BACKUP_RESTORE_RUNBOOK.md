# Backup and restore

Run maintenance tools from a trusted Node/npm checkout with PostgreSQL `pg_dump`/`pg_restore` on PATH. Set explicit BACKUP_DATABASE_URL through protected environment/secret injection; the CLI does not default to application's `.env` database. Use libpq PGSSLMODE=verify-full and PGSSLROOTCERT for external PostgreSQL. Passwords are passed to child environment, not command arguments or console. Never paste a credential in shell history.

Set BACKUP_ENCRYPTION_KEY_FILE to an access-controlled 64-hex independent backup key. BACKUP_DIRECTORY must be protected storage. Backups are streamed from PostgreSQL custom archives into AES-256-GCM encrypted files with timestamp, checksum and authentication manifest. Temporary plaintext is restricted to an owner-only directory and removed in finally. Files use mode 0600 and directory 0700. If interrupted forcibly, inspect and securely remove abandoned `/tmp/mirth-backup-*`/`mirth-restore-*` files. A failed creation may leave an incomplete encrypted artifact; do not treat it as a valid backup.

```sh
npm run db:backup
npm run db:restore -- --file /secure/path/backup.dump.enc
npm run db:verify-restore -- --file /secure/path/backup.dump.enc
```

Restore requires BACKUP_DATABASE_URL selecting an EMPTY local `mirth_disposable_*` database, RESTORE_DISPOSABLE_CONFIRMED=true, and trusted backup provenance. Remote and production targets are rejected unconditionally. It validates checksum/GCM then uses pg_restore single-transaction, exit-on-error, without clean/drop. Verification checks schema versions, user/channel/destination/audit/message counts, encryption readability and message linkage, adds a synthetic VIEWER and tests login/health/readiness against that disposable target. Set BACKUP_SCHEMA and the correct application encryption keyring for the restored schema. Counts are taken before adding the synthetic verification user. Never promote this test database directly to production.

The current runtime and verifier require schema versions **1–6**. For a trusted schema-5 backup, restore to a disposable database first, apply migration 006 with an explicitly isolated environment and the original application keyring, then run verification. Keep the original backup unchanged. The Lite UI update verified migrations and runtime on fresh local databases; a new native backup/restore drill was not run because PostgreSQL backup clients were unavailable. See [the latest verification record](MIRTH_LITE_UI.md#validasi-dan-batas-verifikasi).

Production restore is deliberately operator-controlled through the DR plan, outside this utility. Retention deletion of backups is NOT IMPLEMENTED to avoid silently deleting required recovery evidence. Configure approved encrypted object-storage lifecycle policies only after RPO/retention/legal-hold ownership is agreed. Backup storage, offsite replication, key recovery and full pg_dump/restore drill remain RUNTIME VERIFICATION REQUIRED unless the report records the completed synthetic drill; production/offsite/DR verification remains required.

Reference: [PostgreSQL pg_restore single transaction](https://www.postgresql.org/docs/current/app-pgrestore.html).

The completed local synthetic drill used PostgreSQL 18.4 clients built in /tmp without TLS support. Those binaries are not shipped as production tools. Production backup clients must support verified TLS. Proxy example uses the official unprivileged NGINX image; ensure the certificate/private-key mount is readable only by the configured proxy UID/group, never world-readable. [NGINX unprivileged image reference](https://github.com/nginx/docker-nginx-unprivileged).
