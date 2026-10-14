# ADR: connector plugin boundary

Status: proposed, NOT IMPLEMENTED.

Keep framework and existing REST/MLLP/TCP execution adapters. Introduce a typed Connector capability descriptor containing configuration schema, supported payload formats, credential fields and secret-free versioned export. Lifecycle methods: validateConfig, testConnection (no payload delivery), start/stopReceive, send with correlation/idempotency/revision metadata, and close. Errors normalize into safe retryability/ambiguous-outcome codes; transport cannot make its own unbounded retry loop.

Core owns credentials/keyring, durable reservation and final payload/snapshot, leases, retry/dead-letter state, capacity/circuit breaker, audit and metrics. Plugins receive narrow immutable configuration and explicit secret resolver; they cannot access arbitrary process environment or host database connections. Define contract tests with synthetic fixtures and disposable services before registering a plugin. Import/export rejects unsupported capabilities rather than showing dummy UI controls. Dynamic execution of third-party plugin code requires a separate isolation/security design.
