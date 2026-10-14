# Disaster recovery plan

RPO: [ORGANIZATION TO DEFINE]. RTO: [ORGANIZATION TO DEFINE]. Backup owner: [TO ASSIGN]. Incident owner: [TO ASSIGN]. Escalation contact: [TO ASSIGN]. Approved retention and legal hold: [TO DEFINE]. Recovery infrastructure and secret/key custody: [TO DEFINE].

1. Declare incident and stop new inbound/automatic retry without deleting messages. Preserve audit/log metadata and queue state.
2. Determine last trusted backup and its checksum/key/certificate dependencies. Obtain owner authorization for production recovery.
3. Restore into an empty disposable target; verify schema versions, counts, foreign links, encrypted endpoints/revisions, synthetic login and health/readiness. Measure elapsed recovery time against the organization's RTO.
4. Reconcile deliveries after the backup timestamp with source/receiving systems. DELIVERY_OUTCOME_UNKNOWN needs operator review; never bulk resend merely to clear a dashboard.
5. Prepare the separately authorized recovery environment, secrets, verified TLS, allowlists and published revision. Run migrations in a transaction with preflight and confirmed backup.
6. Execute hospital UAT with synthetic profiles and downstream idempotency. Approve controlled cutover and observe queues/alerts.
7. Record incident timeline, unresolved deliveries, achieved RPO/RTO and lessons. Repeat an isolated drill at an owner-approved cadence.

No production recovery or hospital drill was performed by this change.
