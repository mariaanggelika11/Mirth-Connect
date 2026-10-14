# Implementation plan V2

1. Preserve dirty workspace; collect baseline and source evidence.
2. P0: remediate dependency vulnerability and exposed-secret response; eliminate permanent browser tokens; safe logs/PHI permissions; disable implicit retention; enforce TLS and restore boundaries.
3. P1: additive migrations, revision/publish/rollback, HTTP dedupe, payload profiles, lease fencing, bounded delivery/circuit breaker, key rotation, backup verification, protected metrics and operational webhook.
4. Governance: quality/coverage gate, security scan, CodeQL, dependency updates, container check, issue/PR templates and runbooks.
5. Verify synthetic unit/API, PostgreSQL concurrency/rollback, browser and TLS tests. Fix failures and rerun. Record the final command evidence in IMPLEMENTATION_REPORT_V2.md.
6. Review the implementation and deploy first to disposable/staging infrastructure. Production rollout requires the readiness matrix, hospital UAT, independent security review, load test and DR drill. No automatic push/deploy/history rewrite or production data access.

Feature scope differences and unmet requirements are explicit in GAP_ANALYSIS_2026.md. This plan is not a certification or production authorization.


Follow-up on development: successor draft editing and revision tests; canonical JSON/opt-in reservation TTL; destination policy/reset; bounded XML rules; expanded operational metrics and admin diagnostics; live UI permissions and WCAG checks. Source implementation and native synthetic verification completed for these additions. Remaining settings/XSD/telemetry/export scope and infrastructure verification are explicitly retained in the updated gap analysis.
