# Initial audit — 4 October 2026

Scope: existing local checkout of mariaanggelika11/Mirth-Connect. No framework rewrite.

## Architecture before changes
React 19/Vite → Express 4 management API → SQL Server pooled connection.
HTTP inbound uses a management JWT; shared MLLP listener routes via Channels.filter_script.
Channel engine stores IN, transforms source, sequentially transforms/templates/sends destinations, stores OUT and destination log, updates IN. Monitoring fetches the whole message/log tables. No migrations, tests, README or deployed-schema evidence are present.

## Issues (tracked groups)
P0 (8): tracked environment secrets; JWT fallback and invalid-token handling; registration role injection/no RBAC; vm2 executes administrator scripts in server process; PHI console logging/error disclosure; late unrestricted CORS/CDN scripts; inbound connector isolation/access control; unrestricted destination URLs/credentials.
P1 (10): CR/custom-delimiter/MSH parser; hardcoded ACK and false AA; MLLP fragmentation/multiple frames/timeouts; outbound ACK correlation/raw TCP mismatch; non-atomic channel writes/rollback; message lost between send and persistence; failed resend wrong script/double template; absent durable retries/dead-letter; unbounded monitor queries; absent schema migrations/indexes.
P2 (8): scattered env/timezone; N+1 channel queries; request validation; missing audit trail/trace; startup/readiness/shutdown; silent UI errors/permissions; retention; dependency/tooling/typecheck defects.
P3 (4): documentation; local CSS/CSP; deployment container; broader test coverage.
Total: 30 issue groups. Group counts do not imply every underlying defect is independently enumerated.

## Verification limits
SQL Server is an external dependency. Changes must be verified against a disposable SQL Server database before hospital use; no production DB mutations or Git history rewrite are authorized by this audit implementation.

## Authorized follow-up

After this initial audit, the user authorized PostgreSQL migration using their existing MiniMirthDev database. The current runtime uses PostgreSQL and retains the existing mixed-case tables/IDs. See [PostgreSQL migration report](POSTGRES_MIGRATION.md) for applied changes and live verification. Initial findings above describe the original SQL Server code.
