# Connector roadmap

Stabilize core persistence, receiver profiles, capacity, operational recovery and hospital UAT before adding new connector buttons.

1. FHIR REST sender/receiver + JSON profile validation: require disposable reference FHIR server and synthetic conformance tests.
2. SFTP/File reader/writer: atomic rename, durable cursor, host-key verification, permission isolation, quarantine and crash recovery.
3. Database reader/writer: named configuration schema, parameterized queries, least-privilege connections and transactional cursor/outbox semantics.
4. Scheduler: durable schedule ownership, timezone/DST behavior and misfire policy.
5. Webhook: stable idempotency/secret rotation and signature verification.
6. Kafka/AMQP: durable acknowledgements, partition ordering, offset recovery and broker-disposable CI.

These connectors are NOT IMPLEMENTED and are not advertised by UI actions. Each candidate requires evidence for validation, timeout, retry, error normalization, bounded work, metrics, audit, masking and secret-free import/export.
