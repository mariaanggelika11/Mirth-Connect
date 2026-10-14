# Contributing

Use a feature branch and synthetic fixtures. Preserve local changes; never reset/force push or rewrite shared history without owner approval. Run npm ci, typecheck, lint, format:check, test:coverage, build, test:sql against a disposable schema, and test:e2e. Add meaningful regression tests and additive transactional repeatable migrations. Record actual results and runtime gaps. Never access a production hospital database during development.

Repository-owner recommendations: protect main, require pull requests, one reviewer and CI/security/container checks, disallow force push, review migration/rollback notes, use semantic versions and signed release tags where available. Settings are not changed by this branch. CODEOWNERS is not added because operational code ownership is not established by commit authorship alone.
