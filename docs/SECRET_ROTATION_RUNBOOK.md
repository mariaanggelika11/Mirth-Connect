# Secret rotation runbook

Gitleaks 8.30.1 source scan is clean; its historical finding is a verified synthetic unsigned JWT header, not a credential. The targeted history scan identifies historical environment secrets in `.env` and `server/.env`. Only file/type/commit metadata is retained. Actual rotation status is UNVERIFIED. Obtain each credential owner's confirmation, rotate database/source/API credentials and JWT signing secret, and invalidate old sessions. Never print old/new values or include them in tickets.

Encryption uses `enc:v2:<key-id>:<authenticated ciphertext>`; v1 data remains readable by trying current and previous keys. Set a new independent CONFIG_ENCRYPTION_KEY and unique CONFIG_ENCRYPTION_KEY_ID; retain old keys in CONFIG_ENCRYPTION_PREVIOUS_KEYS JSON in the secret manager. Mount with ENV_FILE or inject via protected process environment. Run against a disposable copy first:

```sh
npm run secrets:rotate -- --dry-run
npm run secrets:rotate
```

The rotation locks records, authenticates every ciphertext, re-encrypts nested connector snapshots and revision configurations in one transaction, and commits a metadata-only audit row. A failure rolls back all updates. Dry-run performs no writes. Counts are printed, never values. Large databases need a maintenance window because this initial implementation locks the complete rotation set; resumable batching is NOT IMPLEMENTED.

Keep old keys until tested encrypted backups and outstanding deliveries no longer need them. Rollback: retain the keyring and select the previous current key/ID, then repeat the controlled rotation. Never replace or remove a key without proving every live record and required backup is readable. CONFIG_ENCRYPTION_PREVIOUS_KEYS must contain only non-current unique IDs with 64-hex keys. Signing keys and encryption keys are independent.
