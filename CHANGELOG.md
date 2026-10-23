# Changelog

## Explain unavailable channel deletion — 2026-10-23

- Keep Delete channel visible to authorized administrators on non-archived channels; disable it with a visible, accessible reason when message history exists or the channel is not stopped. Preserve Archive, role checks and backend deletion safeguards.
- Position the action menu using its measured height and constrain it to the viewport so the extra explanation remains visible on short screens. No API, migration or data change.
- Improve Stop button text contrast after the running-channel accessibility check exposed its previous low-contrast label.

## Preview rejects an empty optional revision summary — 2026-10-21

- Fix the real wizard draft's HTTP 400 in Review & Test: omit empty changeSummary from frontend preview requests and accept bounded blank summaries as absent in preview/full dry-run for older clients. Keep the saved-channel schema and all script/format/permission limits unchanged.
- Add safe setting-specific messages for summary/shared-script/legacy-response/idempotency validation failures. Add an isolated API regression using the actual frontend draft and the two-field JSON-to-HL7 mapping, plus negative validation and no-delivery/audit assertions.

## Compact Review & Test — 2026-10-21

- Show a compact responsive flow and closed configuration details. Put testing behind Test configuration — Optional, move Load sample into Input help and show results only after execution. Consolidate payload diagnostics in Processing details while retaining per-destination output, redaction, audited raw access and separate connection checks.
- Apply required-field checks to direct wizard navigation as well as Continue/Save, returning incomplete channels to their editing step. Preserve receive-only channels, draft/publish semantics and all backend enforcement; no migration or API change.

## Script help templates — 2026-10-21

- Add Use template inside Script help, using the example for the current script type. Confirm before replacing nonempty custom code; Cancel preserves it. Insertion edits only the dialog, with Save Script and Save Channel still required. Sandbox, permissions and execution remain unchanged.

## Destination progressive disclosure — 2026-10-21

- Keep name/connector/output/endpoint in the primary form; use separate closed Transformation, Filter, Delivery and contextual HL7 settings. Retain multi-destination and advanced custom scripts; show Enabled in the saved destination header without bypassing draft/publish.
- Collapse connector aliases to HTTP/MLLP/TCP sender labels while preserving saved REST/HL7/MLLP/TCP/RAW values. Keep HTTP overrides/retry/timeout in Delivery and capacity/circuit tuning in Expert delivery settings.
- Show fixed HL7 v2.5 as read-only; replace the Description column with meaningful target labels and full-width row Options. Remove manual time/control-ID inputs; preserve existing overrides and offer an explicit form-only reset to generated defaults.
- Preserve backend validation, compiled mapping/runtime, snapshots, transport security, secrets, audit and data. No API/schema/migration/dependency changes.

## Transformation layout and mapping usability — 2026-10-21

- Show one source/target header, compact mapping rows, inline mode choices, content-sized Add Mapping and closed per-row Options. Retain Required/default/type conversion, validation, explicit pass-through confirmation and destination-specific HL7 mapping.
- Fix nested script dialog layout by limiting wizard body styles to its direct body. Give script dialogs a full-width editor, stable footer, optional help and shorter placeholders. Explicit button types prevent Save Script/Cancel from submitting the channel form.
- Preserve compiled mapping bytes, saved scripts, execution/sandbox behavior and all format/test ownership. Clarify that shared mapping excludes unmapped fields. Make the Channels table scroll region keyboard-focusable after a mobile accessibility check exposed the empty-table case.

## Source layout alignment — 2026-10-21

- Start Source directly with Channel name, connector and inbound format. Show endpoint/key controls only after Save; expose the actual endpoint directly in Channel saved before key setup, keeping one-time key display/rotation and protected synthetic send unchanged.
- Keep one closed Advanced with Validation and Filter only. Move legacy source response notice to Review details without changing its stored script or runtime. Remove the duplicate visible validation heading, shorten the schema editor and collapse source path help.
- Report Filter Off / Needs configuration / Configured from actual validity. Add concise shared MLLP routing guidance. No backend, API, dependency, migration or data changes.

## Remove Source sample panel — 2026-10-21

- Remove Sample message, example loading, field analysis and their wizard-only state/refresh controls from Source. Keep test input and Load sample only in Review & Test.
- Keep direct source/target mapping, HL7 target selection, core pipeline/security and the protected discovery API. Delete the unused SourceSample component/styles; retain synthetic Review fixtures in testSamples.ts. No API, migration or data changes.

## Compact destination connection form — 2026-10-21

- Show Destination name, Connector, Outbound format and Endpoint, followed by one closed Advanced destination settings. Move HL7 type/version/mapping into Advanced without duplicating or resetting the transformer. Keep transport-specific Host/Port/TLS for MLLP and Add Destination.
- Remove Authentication/Custom Headers/environment-slot editors from the UI. Preserve saved authentication/header metadata and backend enforcement; keep HTTP method and Content-Type under Delivery settings. No database migration or data reset.
- Verify compact desktop/mobile layout, keyboard/Axe, exact saved mapping retention, delivery error focus and authentication/header retention using synthetic fixtures. Current command results are recorded in the [follow-up audit](docs/UI_SIMPLIFICATION_AUDIT.md#compact-destination-follow-up--2026-10-21).

## Channel wizard UX cleanup — 2026-10-21

- Keep Source → Transformation → Destinations → Review & Test. Hide unassigned source URLs, shorten API-key guidance, restore safe Copy Endpoint for saved channels, and show optional sample fields only after analysis. Samples stay in form memory.
- Give shared transformation one UI entry in Step 2: No transformation by default, Modify fields on demand, saved mappings/scripts preserved, confirmation before clearing. Remove the duplicate Source Advanced transformer shortcut while retaining its existing runtime stage.
- Merge destination technical controls into one Advanced section with flat authentication/processing/delivery groups. Keep HL7 mapping inline; open other mappings inline without a second configuration dialog. Preserve environment secret references, filters, legacy output scripts, retry, capacity and circuit settings. Default values no longer produce a Customized badge.
- Report field-specific HTTP/header/delivery validation after touch or a failed attempt; reveal and focus invalid controls without clearing saved overrides. Keep stable accessible names and backend validation. Use one scrolling wizard body with navigation/footer visible and concise Review summary/Run Test/result; details remain available.
- Verification: **731 unit/API tests / 47 files**, **108 browser cases**, unchanged coverage **87.44/85.59/89.74/88.47%** statements/branches/functions/lines; typecheck, lint, format, client/server build, OpenAPI structure, targeted working-tree secret scan and local link/diff checks pass. Native PostgreSQL, other browser engines and hospital UAT were not tested in this UI task. Details: [wizard cleanup audit](docs/UI_SIMPLIFICATION_AUDIT.md#full-channel-wizard-cleanup--2026-10-21).

## Compact destination HL7 mapping — 2026-10-21

- Keep the four-step wizard; shared Step 2 mapping remains optional and untouched blank rows are ignored. HL7 destination configuration is inline with only type/version and a flat source/target/description table. One shared field picker opens a searchable component tree on demand, closes after selection and restores keyboard focus; explicit indexed paths remain available.
- Collapse header/custom script fields under Advanced HL7 Settings. Hide duplicate destination transformer controls for HL7; HTTP method/content type/authentication/header references move into HTTP request options. Preserve existing mappings, sandbox scripts, filters, transport settings and all per-destination pipeline stages.
- New JSON/XML PID-7 selections use the existing strict ISO date conversion; saved conversions stay intact. PID-5 retains full scalar text in component 1 without inferring name parts. Backend compiler/runtime and database schema are unchanged.
- Review shows output/status first; stage diagnostics remain available in Advanced. Copy Output copies only the authorized preview already received, preserving redaction and CR bytes.
- Verification: **711 unit/API tests / 46 files**, **104 browser cases**, unchanged **87.44/85.59/89.74/88.47%** statements/branches/functions/lines coverage; typecheck, lint, format, client/server build, OpenAPI structure and targeted working-tree secret scan pass. Native PostgreSQL/hospital runtime were not tested in this UI task. Details: [UI audit](docs/UI_SIMPLIFICATION_AUDIT.md#compact-hl7-destination-ui--2026-10-21).

## Enforce browser session inactivity and absolute expiry — 2026-10-21

- Set browser defaults to a 15-minute idle deadline, one-minute warning and maximum eight-hour lifetime since login; keep memory-only access JWTs at five minutes. Cap legacy seven-day refresh configuration at the absolute limit. Authenticate every browser JWT/refresh/activity against locked family state; polling/refresh never updates last activity, and expired families cannot be revived.
- Add transactional/repeatable migration 008 with `BrowserSessionFamilies`, index/FK and one-time revocation of legacy sessions without deleting business/token/audit history. Update startup/preflight/reset/restore/runtime tooling to schema 1–8. Browser login/refresh/`/me` expose safe deadlines; authenticated+CSRF activity is bound to the current cookie/family and uses server time. Expiry/reuse/logout/manual revoke invalidate family and rotated rows with audit; legacy Bearer automation and source channel keys retain separate behavior.
- Add accessible Session expiring / Continue session / Sign out UI, server/monotonic countdown, resume checks, trusted throttled activity and cross-tab logout. Serialize auth mutations, ignore late responses/stale 401, persist credential-free logout intent with cookie fallback, disable silent restore when storage is unavailable, and offer Retry sign out when revocation fails. Session list uses idle/absolute expiry. Background refresh/activity rotation races fail safely.
- Keep strict credential brute-force budget 20/minute/IP across aliases; separate session maintenance 300/minute/IP and logout 60/minute/IP so polling cannot exhaust login/logout budgets. All scopes remain bounded. Add actual limiter negative tests.
- Verification: **706 tests / 46 files**, **102 browser tests**, typecheck/lint/format/build, OpenAPI structure (49 paths / 53 operations), targeted source secret scan and local links/diff pass. Coverage **87.44/85.59/89.74/88.47%** statements/branches/functions/lines, up from 86.64/85.26/88.69/87.44. Browser virtual-time tests cover 15-minute / 8-hour / 3-day boundaries, active use, cross-tab, failed logout/storage disabled/race, and warning Axe checks; persistence remains isolated.
- Latest **29-case PostgreSQL suite and migration 008 runtime NOT TESTED** locally; no disposable Postgres/Docker tools available. No live environment/database modification, deploy, commit or push. Schema 8 must be migrated with verified backup before restart; all legacy browser users then sign in again. See [session policy/rollout](docs/OPERATIONAL_CONTROLS.md#browser-session-policy--21-october-2026), [manual](docs/MIRTH_LITE_UI.md#browser-session-timeout--21-october-2026) and [actual verification report](docs/UI_SIMPLIFICATION_AUDIT.md#browser-session-hardening--2026-10-21).

## Field discovery, HL7 V2 mapping and real format delivery — 2026-10-18

- Keep Source → Transformation → Destinations → Review & Test. Add one reusable searchable/keyboard field tree and picker for JSON objects/arrays, XML elements/attributes and HL7 segments/components/repetitions. Optional Source synthetic samples discover fields through a permission-checked/audited endpoint; sample values are not persisted or returned in discovery metadata.
- Extend the existing sandbox mapping compiler with canonical V2 metadata, strict type/date conversions, required/default behavior and safe inline errors. Preserve V1 generated bytes and legacy scripts. Configure four curated HL7 v2.5 profiles per destination: ADT A04/A01, ORU R01 and ORM O01. Reuse the existing HL7 serializer/parser, generated UUID/explicit UTC timestamps and validated header/profile rules. This is a tested subset, not complete HL7 or hospital conformance.
- Expose working REST POST/PUT/PATCH, compatible media types and per-ID server environment references for Basic/Bearer/custom headers. Keep credential values out of configuration/API/preview. Reject invalid final header values before transport without a fake attempt or retry; preserve UTF-8 Basic through Base64. MLLP uses Host/Port/TLS and correlated framed ACK handling. Optional advanced destination conditions remain sandboxed.
- Review uses the same engine pipeline and shows actual output per destination, parsed input and a metadata-only HL7 tree. XML/HL7 parsed values remain fully redacted by default; raw requires existing permission/audit. Discovery and dry-run do not send a message. Explicit custom-script replacement preserves V2 mappings on cancel.
- Verification: **656 tests / 42 files**, **94 browser tests**, typecheck/lint/format/build, OpenAPI structure (48 paths/52 operations), targeted source secret scan and diff/link checks PASS. Coverage **86.64/85.26/88.69/87.44%** statements/branches/functions/lines, above the preceding Destination baseline. Real local HTTP/MLLP receivers prove eight format pairs, isolated destinations, method/auth headers, preview parity and ACK/non-delivery failures; persistence is a stateful fixture. Two passing screenshot cases were recaptured separately.
- No new migration/dependency, live database/environment modification, commit or push. The latest 24-case PostgreSQL suite is extended but **NOT TESTED** locally; Docker, deployed runtime, hospital UAT/load/security/backup/DR qualification remains outstanding. See [implementation audit](docs/UI_SIMPLIFICATION_AUDIT.md#field-explorer-hl7-and-format-integration--2026-10-18) and [manual / downgrade constraints](docs/MIRTH_LITE_UI.md#field-discovery-v2-mapping-and-hl7--18-october-2026).

## Simplify and enforce destination filtering and transformation — 2026-10-18

- Replace the destination filter mode dropdown with Enable destination filter and the existing safe condition builder. OFF retains the exact saved rule; disabled destination and enabled filter remain separate. Preserve legacy scripts read-only with explicit replacement. Correct legacy bare false evaluation so it cannot fall through to unconditional delivery.
- Reuse the visual mapping editor per destination with isolated input, required/default/path validation, invalid-edit retention and optional sandbox scripts. Preserve the pipeline: Source validation/filter/transformer → destination filter/transformer → legacy output script → converter → sender. Remove Add template for new configurations; retain and explain existing output scripts inside transformation settings.
- Separate preparation outcomes from transport attempts. Filtered/error preparation creates no network log or retry; final output and encrypted preparation_version:1 snapshot become available atomically after successful conversion. Resend/retry rejects unprepared or unprovable historical work, and sends only stored final payload. Preserve legacy transport/admission evidence and ambiguous-outcome reconciliation. Exclude known endpoint/host/address pre-network rejections from network timing/counts and automatic retry. Treat HTTP 4xx other than 408/429 as permanent; keep transient retry settings unchanged.
- Validate final XML and XML→JSON against bounded parsing and DTD/entity denial; preserve valid raw XML bytes. Review shows per-destination matched/disabled/not-run/not-sent stages. Messages adds safe processing outcomes and actual or unknown attempt counts, without labeling historic processing-only events as delivery. No schema migration, reset, live configuration rewrite or new dependency.
- Verification on development based on 30ceaa5: 529 unit/API/integration tests across 37 files and 82 browser tests PASS. Actual loopback receivers prove JSON→XML/XML→JSON payload/content type, mapping/preview parity, isolated destinations, filter/non-delivery, retry and preparation/resend guards (database is mocked). Coverage rises from 85.61/83.31/87.24/86.40 to 86.27/84.15/87.81/87.10 statements/branches/functions/lines. Typecheck, lint, format, production builds, OpenAPI structural check and targeted source secret scan PASS.
- Real PostgreSQL test scenarios were extended but NOT TESTED locally because PostgreSQL/Docker tools are unavailable. Live legacy inventory, deployed-server verification, hospital UAT and production load/security review remain NOT TESTED. Stop/drain/reconcile work before binary downgrade; old binaries lack the new resend guard. See the destination audit and manual for compatibility, actual failures corrected, screenshots and rollout limits.

## Make Source Message Validation explicit and enforceable — 2026-10-18

- Audit before implementation verified Basic syntax adds no field requirements, XML/HL7 parsing already applies without it, and legacy JSON-object Basic has separate semantics. Custom previously expected an internal profile wrapper; a bare JSON Schema could be stripped to an empty profile on save. Keep precise legacy behavior while rejecting unknown active profile keys.
- Replace Basic for new configuration with JSON Field validation: field path, strict Text/Number/Boolean/calendar Date, Required and optional exact allowed values/text length/number range. Bound rules/paths/values, use own data properties, preserve zero/false, distinguish missing/null/blank and never coerce or transform input. XML/HL7 keep bounded format-specific custom rules, with explicit examples; no XSD/full HL7 profile or JSON-only rule support is claimed for other formats.
- Add versioned active-mode settings with retained inactive field/custom/legacy configuration in existing validation_profile and encrypted revision snapshots. No schema migration or live database change. Scrub nested custom/legacy scripts from revision review/diff; document compatible-configuration requirements before binary downgrade.
- Use the same evaluator for inbound and Review. A failed input produces FIELD_VALIDATION_FAILED/IN-ERROR and no outbound reservation, network attempt or delivery retry. Capture bounded safe per-field reasons in existing last_error; HTTP details, Review and Messages expose field/type/status/fixed reasons without payload values, allowed-list values or arbitrary exception text. Source Filter and mapping Required remain separate. Existing MLLP routing selection precedes per-channel validation and a selected-channel rejection retains ACK AE.
- Add explicit custom-schema guidance, opt-in examples with replacement confirmation, JSON-only builder visibility, valid-state badges, clear legacy summaries and responsive field rows. Fix success/error contrast found by the save/reopen accessibility scenario. Manual section 8.3, API schema/error catalog, architecture and synthetic before/after screenshots reflect actual capabilities.
- Verification from baseline development 908e208: 413 initial tests → 472 unit/API/integration tests across 34 files; 72 browser tests. Coverage 85.61% statements / 83.31% branches / 87.24% functions / 86.40% lines, above baseline 84.44/80.88/86.45/85.37. Typecheck, lint, format, client/server production builds, OpenAPI structural checks and targeted source secret scan pass. Integration uses real evaluator/QuickJS and loopback HTTP/MLLP with database/outbound transport isolated, not a hospital deployment.
- Initial verification issues were recorded and resolved: baseline approval review timed out and succeeded on one retry; sandbox Supertest socket EPERM reran with loopback permission; import-type lint violation was corrected; a new browser test used an unsuitable label locator and now uses the accessible combobox role; Axe exposed notification contrast and the fix passed the full browser suite. Live PostgreSQL persistence/deployed-server verification, hospital UAT and production load testing are NOT TESTED for this change.

## Simplify Source Filter with persistent disabled rules — 2026-10-18

- Source Filter now exposes Enable source filter and one Field/Operator/Value condition builder. Remove its accept/reject/custom dropdown and script editor. Preserve legacy filters with a notice and explicit replacement; new channels default OFF. Destination routing/script controls remain available.
- Retain disabled rules in a validated no-op wrapper in the existing filter_script column, including encrypted revision snapshots and XML import/export. Reopening restores OFF state and the exact rule. No schema migration, bulk configuration rewrite or remote database mutation.
- Add Is empty/Is not empty with defined missing/null/scalar semantics. Preserve canonical bytes for all ten previous operators, prototype/path restrictions and isolated QuickJS execution. Reject malformed reserved metadata on save/runtime; record IN-ERROR with safe codes and never deliver. Nonmatching messages retain FILTERED status and skip transformation/outbound reservation.
- Verification includes the actual inbound processor and QuickJS with isolated database/transport, HTTP API validation/storage/snapshot checks with a database fixture, structured JSON/XML/HL7 conditions and browser save/reopen/legacy/accessibility regressions. Full unit/API coverage: 413 tests, statements 84.44%, branches 80.88%, functions 86.45%, lines 85.37%; previous documented baseline 84.08/80.48/86.36/84.98. Typecheck, lint, format, client/server builds, targeted source secret scan and OpenAPI structural check pass.
- Initial checks exposed a narrowed TypeScript branch after hiding the source script editor (fixed), local Supertest socket EPERM (rerun with socket permission), and an incomplete database fixture that returned an empty filter after writes (fixture corrected and coverage rerun). These were not treated as passing results. Live PostgreSQL/deployed-server verification is NOT TESTED; database and transport are isolated in automated tests. See the UI guide for storage limits, single-condition scope and downgrade compatibility.
- Final browser regression: `npm run test:e2e` passes all 67 tests, including create → save OFF → reopen → enable with the saved condition restored, legacy preservation/replacement, unfinished-condition blocking, permission checks and accessibility. All ten previous operators were compared against HEAD and retain identical canonical output.

## Simplify the Revisions panel — 2026-10-17

- Replace repeated revision cards and actions with one Version selector and a stable summary pane. Select the latest draft or active revision automatically, show its status, and expose only the relevant Edit draft, Publish or Rollback action.
- Remove automatic scroll/focus movement; ignore stale responses when switching versions quickly. Keep inline loading, errors and retry. Move comparison, sanitized JSON, optional notes and explicit synthetic/connection tests into Advanced options. Preserve permissions, confirmation, audited raw access and backend lifecycle behavior.
- Improve revision error contrast. Browser verification includes long history, stable layout/focus, rapid selection, error recovery, mobile overflow, accessibility and existing draft/publish/rollback workflows. No backend, migration or database changes.
- Fix dialog keyboard focus to skip controls inside closed disclosures. Final verification: `npm run test:e2e` passes all 64 synthetic browser tests; workspace typecheck, lint, format, client production build and targeted source secret scan pass. Earlier browser failures exposed contrast, scrollable-region keyboard access and hidden-disclosure focus issues; these were corrected and rerun. Backend unit/PostgreSQL tests and deployed-server verification were not rerun for this frontend change.

## Make configuration review immediately visible — 2026-10-17

- Render Review configuration directly inside the selected revision instead of appending its JSON below the entire revision list. Move keyboard focus and scroll to the review heading after loading/error/success so long history no longer makes the action look unresponsive.
- Add inline loading/error/retry behavior, disable duplicate review clicks while fetching, and clear stale comparison output when reviewing a revision. Show readable source/transformation/destination/retry/timeout summaries with sanitized JSON under an optional disclosure; retain explicit, permission-aware connection probes alongside the selected configuration. No automatic network probes, backend/data/migration changes or additional secret access.
- Verify three targeted browser scenarios: a 20-revision history with loading/focus/visible result and Axe checks; inline permission error followed by retry; existing draft/dry-run/connection-probe workflow. Client build, workspace typecheck, lint, format, targeted source secret scan and diff checks pass. Full unit/PostgreSQL/browser suites are not rerun for this UI-only follow-up.

## Revision flow, rollback and safe channel retirement — 2026-10-17

- Add a direct Review and publish draft action after saving, an Active revision badge, refresh of server-side active revision, collapsed optional note/test controls, explicit loading state, and publish/rollback confirmation. Hide rollback for the already active revision. Keep synthetic testing, sanitized comparisons, permissions and audited raw previews.
- Saving creates the latest draft and archives preceding drafts under the channel lock; legacy competing drafts display SUPERSEDED and cannot publish. Publish/rollback remain atomic with expected-active conflict checks, create immutable published history and archive pending drafts. Capture actual persisted destination IDs so repeated rollback reuses the right connector records. Rollback never restores source API keys.
- Permit ADMIN to permanently delete a STOPPED channel without retained messages, including a new unused duplicate with revision 1; remove its own revisions/connectors/runtime state in the same audited transaction. Retained messages block deletion. Add ADMIN-only Archive for stopped channels without queued/active/retrying/leased messages; retain all message/revision/audit history, hide archived rows by default and add the Archived filter. Archived channels cannot start, edit or activate revisions. Retention behavior is unchanged; no permanent ever-used marker is introduced.
- Revalidate the channel under a shared lock through inbound reservation so acceptance cannot race with stop/delete/archive/publish using a stale configuration. No migration or external database changes; archive uses the existing status column and schema remains 1–7.
- Verification: 403 unit/API tests across 30 suites; coverage 84.08% statements / 80.48% branches / 86.36% functions / 84.98% lines, above the prior XML-import baseline. Native PostgreSQL 18.4 passes all 22 disposable integration scenarios, including legacy competing drafts, repeated rollback IDs, unused-copy deletion and archived history protection. All 61 browser scenarios pass, including publish/rollback confirmation, delete, archive, read-only archived history, visible pending-draft review and confirmation before replacing unpublished edits. Typecheck/lint/format/build, OpenAPI structural validation (47 paths / 51 operations), targeted source secret scan and diff checks pass.
- Initial unit run had two stale mocks that lacked the newly read canonical runtime configuration; update those fixtures and rerun successfully. Temporary PostgreSQL was stopped and its data removed. Production deploy/UAT/load/DR and remote CI execution are not verified by these local checks.

## Verify channel XML import — 2026-10-16

- Fix empty/whitespace/comment-only XML returning a null-parser TypeError: reject safely with HTTP 400 `INVALID_CHANNEL_XML` instead of HTTP 500. Three added regression cases initially failed and pass after the fix; all nine XML parser tests pass.
- Add a real PostgreSQL multipart import regression covering persisted STOPPED channel, destination retry/timeout, initial revision/audit, frontend export→import with a fresh ID, invalid/native/XXE/metadata/oversized/missing/wrong-field uploads and denied anonymous/Viewer/Operator access. Rejections leave the channel count unchanged.
- Run the complete native PostgreSQL suite: 20/20 pass on a new disposable local PostgreSQL 18.4 cluster/schema through migration 007. Run real-browser login→file picker→HTTP 201→listed persisted channel and malformed-file HTTP 400/error UI against the compiled backend without API mocks. Stop and remove the temporary cluster/backend/browser; existing application databases and environment files are untouched.
- Browser harness initially failed due to workspace bcrypt resolution, then a local bundle targeting localhost:9000 instead of the disposable backend. Correct harness dependency lookup and use a temporary same-origin frontend build; the final end-to-end run passes. Restore the ordinary frontend build afterward.
- Full unit/API suite: 383 tests / 30 suites pass; coverage 83.03% statements / 79.78% branches / 85.24% functions / 84.00% lines. Build, typecheck, lint and formatting pass. Native NextGen/Mirth exports remain explicitly unsupported; document the accepted format in README.

## Preserve security through UI simplification — 2026-10-16

- Retain authentication, four-role RBAC, per-channel source keys and one-time display, rotation, payload redaction/raw audit, encryption, sandbox, safe errors, request limits, correlation and idempotency. No database, production data or environment secrets changed.
- Limit unsuccessful source API-key requests to 60 per IP/minute per process before more database lookups. Keep existing authentication/management limits and compatibility routes. Document failure-budget/NAT/distributed-limit implications.
- Require explicit allowlisting for private/loopback destinations, including development; reject prohibited metadata/link-local/unspecified/multicast addresses, pin DNS answers and retain redirect rejection. Preserve intentionally allowlisted hospital network destinations.
- Reject obvious placeholder/repetitive current secrets during production config loading. Add negative API tests, real logger leakage assertions, fail-closed raw auditing, DNS-rebinding/pinning and real redirect rejection tests.
- Verify 380 unit/API tests in 30 suites and 57 browser scenarios; coverage rises to 82.99% statements / 79.73% branches / 85.24% functions / 83.96% lines. Typecheck/lint/format/build, OpenAPI structure, targeted source scan and dependency audit (0 vulnerabilities) pass. Initial loopback sandbox test failure was corrected by rerunning with local-socket permission.
- Record each security control and unverified deployment requirements in [SECURITY.md](SECURITY.md). Deployed HTTPS/firewall/certificates, full Gitleaks/history scan, remote CI, fresh PostgreSQL concurrency and production operational qualification remain NOT TESTED in this review.

## English application interface — 2026-10-16

- Translate the remaining Indonesian source API-key helper into English and review application-authored UI/backend messages for mixed-language text.
- Use explicit en-US formatting for displayed dates, session/alert timestamps and message counters. Keep the browser's local timezone and existing stored values.
- Verify client build, workspace typecheck, lint, format and 57 browser scenarios. A synthetic browser check using id-ID also confirms English helper text, month names and number separators. Refresh the two source-editor screenshots. Initial formatting and screenshot-filter issues were corrected and their commands rerun successfully.

## Consistent dropdowns — 2026-10-16

- Standardize dropdown sizing, padding, chevrons, focus/disabled states and selected options across filters, channel forms, Messages and Settings. Supported browsers use an anchored, scrollable native picker; other browsers retain the system picker.
- Bound long labels and menus to the viewport, and give mobile search/filter controls room without horizontal page overflow.
- Let Escape dismiss an open picker before closing its enclosing dialog; extend the existing mobile keyboard/accessibility regression scenario.
- Verify client build, workspace typecheck, lint, format and 57 browser scenarios. Synthetic desktop/modal/mobile checks also pass for proportional menu bounds, scrollable options, keyboard selection, Escape and long labels; initial mobile overflow and dialog-dismissal failures were corrected before the final runs. No database/dependency changes.

## Focus mapping and move testing to Review — 2026-10-16

- Base this follow-up on development commit `1734591`. Keep Source → Transformation → Destinations → Review & Test and all existing engine capabilities.
- Make Transformation mapping-only: Source Field / Target Field, Add Mapping, and optional Advanced Custom Transformation Script. Keep Required/default inside collapsed Mapping options. Preserve existing wrapper metadata and legacy scripts without a root field or automatic Patient wrapper.
- Let Source own inbound format and each destination own its outbound format independently. Remove Step 2 format selectors, examples, sample input, preview/test actions, privacy controls and test-result banners.
- Move transformation tests, generated output, safe actionable errors and audited Advanced test options to Review & Test. Move explicit destination connection probes there after complete configuration; preview remains DNS/network-free, probes send no application data, and confirmed post-save synthetic delivery remains available.
- Add safe actionable preview-error guidance without changing the runtime pipeline, converter or database. Keep schema 1–7 and existing source/destination filters, transformers, routing, retries, monitoring, responses and revision behavior. No database data changed.
- Verify this follow-up with 345 unit/API tests across 28 suites and 57 browser tests. Typecheck, lint, formatting, client/server build, OpenAPI structural checks (46 paths / 50 operations), targeted source secret scan, local Markdown links and diff checks pass. Coverage increases from 81.90% / 78.61% / 83.63% / 82.96% to 82.09% statements / 78.80% branches / 83.84% functions / 83.12% lines. Capture six fresh synthetic screenshots; an additional screenshot-only browser case passes.
- Native PostgreSQL 19-test and compiled-runtime results below are historical evidence from `1734591`, not reruns for this follow-up. No fresh npm ci, dependency audit, database migration, Docker, hospital UAT, load or disaster recovery drill is claimed.

## Final simplification and Mirth-style flow — 2026-10-16

- Retain Source → Transformation → Destinations → Review, visual mapping and the complete source/destination pipeline. Add format-aware Basic validation, a Field/Operator/Value filter builder and explicit transformer configuration through Advanced.
- Separate destination filter, transformer and delivery settings. Remove response-script editors from new-channel UI while preserving legacy responses, validation profiles, filters, transformers, routing, retry and multiple destinations in configuration and runtime. Generate draft audit summaries automatically.
- Simplify Overview to six real metrics and Recent Failures. Keep Users, Roles, Audit and System information in Settings; retain sessions, operational alerts and diagnostic export through disclosures instead of raw runtime JSON.
- Preserve redaction and audited raw access. Show actual HTTP status, captured transport duration and exact complete-history attempts in Messages; unknown legacy or mixed-history values remain unrecorded. Add nullable request duration in migration 007; admission/backpressure events are excluded from delivery counts.
- Add safe code/message/requestId/details fields to persisted failed HTTP results while preserving the complete legacy result; verify FAILED/PARTIAL/IN-ERROR, FILTERED 200 and QUEUED 202 responses.
- Verify 332 unit/API tests across 28 suites, 53 browser tests, 19 native PostgreSQL tests, and compiled isolated-runtime health/readiness, metrics authorization and active-delivery SIGTERM. Typecheck, lint, formatting, build, OpenAPI structural checks and targeted source secret scan pass. Coverage rises to 81.90% statements, 78.61% branches, 83.63% functions and 82.96% lines.
- Apply migration 007 to MiniMirthDev after preflight; verify schema 1–7 and unchanged counts of 1 user, 1 channel, 1 destination, 2 messages and 1 destination log. Rebuilt development health/readiness return 200 and SIGTERM exits 0 without a payload send; the environment file is unchanged. No production data changes. A fresh native schema-7 backup/restore drill remains unverified because PostgreSQL client utilities are unavailable; production readiness remains incomplete.
- Verification is for the development working tree based on `a43c693`; see [the audit](docs/UI_SIMPLIFICATION_AUDIT.md), [manual and upgrade guidance](docs/MIRTH_LITE_UI.md#database-upgrade-dan-compatibility), and [readiness matrix](docs/PRODUCTION_READINESS_MATRIX.md).

## Remove endpoint copy and request examples — 2026-10-16

- Remove Copy endpoint, curl/Postman request examples and placeholder instructions from the shared endpoint display; retain the source URL and one-time API-key copy.
- Remove unused example generation and styles while preserving confirmed synthetic-send payloads and headers. Remove two export-only tests with the deleted feature; retain format/request coverage.
- Verify build, typecheck, lint, formatting, 301 unit/API tests and 45 browser tests. No backend or database changes.

## Simple filter choices — 2026-10-16

- Replace source/destination boolean textareas with explicit accept/filter or deliver/skip choices; keep custom conditions in Advanced.
- Preserve existing scripts until an explicit selection, including legacy bare boolean text, and retain custom edits while switching choices.
- Verify build, typecheck, lint, formatting and 45 browser tests. No backend or database changes.

## Startup migration diagnostics — 2026-10-16

- Replace the generic missing-schema startup cause with safe MIGRATION_REQUIRED instructions; retain the schema-6 guard and manual migration requirement.
- Apply additive migration 006 to the configured development database after preflight; verify existing business counts and rebuilt backend health/readiness, then stop the test process cleanly.
- Verify 303 unit/API tests, including three startup regressions, typecheck, lint, formatting and build. A sandbox socket restriction required rerunning the suite with local loopback access.

## Documentation cleanup — 2026-10-16

- Remove ten superseded audit, baseline, plan, implementation and UI/migration reports; preserve their history in Git.
- Consolidate current UI guidance and remaining source/runtime scope in the Lite UI manual and production readiness matrix; retain security, architecture, operational and development recovery documentation.
- Repair documentation references and reconcile outdated session, schema, idempotency and metrics instructions. Application code, database and backups are unchanged.

## Visual transformation and four-step wizard — 2026-10-16

- Use Source → Transformation → Destinations → Review, with visual field mapping, Required/default values, input/output previews and optional scripts.
- Preserve source/destination filters and transformers, routing, multi destination, retry, timeout, monitoring and start/stop. Keep advanced configuration and custom scripts intact; make change summaries optional in the UI with automatic audit descriptions.
- Add a permission-controlled transformation preview before endpoint setup, using the existing sandboxed engine without network operations.
- Show Inbound Message, Source Processed Message, Outbound Message and Delivery Result. Record actual HTTP status through nullable schema-6 migration; immediately hide raw payload when permissions change.
- Verify 300 unit/API tests, 41 browser tests, 19 disposable PostgreSQL integration tests, CLI migration twice and compiled runtime startup/drain. Coverage increases to 81.11% statements, 76.82% branches, 82.75% functions and 82.25% lines.
- Migration 006 is required before deploying this build. No remote database migration was performed. See [usage, limitations and migration notes](docs/MIRTH_LITE_UI.md).

## Compact channel editor — 2026-10-16

- Reduce setup to Source → Destinations → Review; move optional source processing into Advanced.
- Collapse connection/key management, curl/Postman examples, sample previews and synthetic test delivery; retain one-time key display and delivery confirmations.
- Group destination details behind compact disclosures and retain configured indicators and existing values.
- Verify 267 unit/API and 33 browser tests, including closed-panel configuration retention, pending key operations, keyboard/mobile and accessibility. No backend or database changes.

## Development usability — 2026-10-16

- Simplify channel setup with optional source processing and Advanced settings; automatically describe the initial configuration while retaining required edit summaries.
- Add authoritative public source URLs, placeholder curl/Postman exports and post-save key/start/synthetic-test guidance.
- Add destination TCP/TLS connection tests without application payloads and structured, masked/audited output previews.
- Separate inbound, source processed and final destination payloads in Messages using captured revision/transport metadata.
- Preserve operator sessions after source-key failures; preserve TEXT input types in stored revision previews; improve Advanced text contrast.
- Verify 267 unit/API tests, 29 browser scenarios and 18 disposable PostgreSQL integration tests. No database migration or runtime production changes.

## Development source cleanup — 2026-10-14

- Remove the unused Modal `keepMounted` prop and backend `Direction` type.
- Remove 20 lines of CSS declarations superseded by later rules with the same specificity; retain the effective styles.
- Verify source import references, HTML/package entry points, maintenance commands and the dynamically loaded script worker. No unused source file was identified; retain database backups, migrations and operational tools.

## Unreleased — production hardening V2

Memory-only UI access tokens and rotating HttpOnly refresh sessions; CSRF and family revocation; keyed encryption and controlled rotation; safe metadata logs and redacted/raw permission; optional scoped HTTP idempotency; encrypted channel draft/publish/rollback; channel profile/dry-run; dead-letter reconciliation; lease owner fencing; persisted circuit/concurrency controls; protected metrics and initial webhook alert; safe encrypted disposable restore tooling; CI/security/container configuration and runbooks.

Safety behavior changes: channel PUT saves a draft; publish activates it. DELETE refuses retained revision history. Browser sessions from localStorage require fresh login. Default automatic retention is disabled. Ambiguous timeout/ACK goes to dead letter. Production plaintext MLLP requires an explicit isolated-network exception; verified PostgreSQL TLS remains mandatory. Review README and ADR before upgrading.


## Development follow-up — 2026-10-14

- Add schema-5 destination circuit policies, idle-only audited reset and guarded HTTP-key TTL with historical/canonical digest metadata.
- Add secret-preserving successor draft editing, stored revision dry-run and explicit pinned DNS/TCP/TLS probes without application payload.
- Add bounded XML profile rules, expanded metrics, ADMIN effective settings and audited metadata diagnostics.
- Reconcile active UI roles; protect dirty draft edits; add Axe checks and improve text contrast.
- Expand to 234 unit/API, 17 native SQL and 19 browser tests; raise coverage gates and add OpenAPI structural CI check.
- Production/hospital certification and remaining feature scope stay explicitly incomplete.


## Development database maintenance — 2026-10-14

- Add guarded snapshot backup, disposable restore/reset rehearsal and atomic single-ADMIN cleanup CLI with rollback/source-change/dependency protection.
- Support pg_dump exported snapshots without putting credentials in arguments; add process/encryption/file-permission regression tests.
- User-approved MiniMirthDev migration 1→5 and reset completed; admin@gmail.com and its original password hash preserved.
