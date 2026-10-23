# Safe error contract

Errors return success=false, code, safe message and requestId; central handler adds details=[]. Legacy success response shapes remain. Some existing limiter responses retain their legacy minimal shape. SQL, stack, paths, credential values and raw payloads are not returned. Script/remote exceptions become diagnostic codes.

| Code | HTTP / meaning |
| --- | --- |
| NO_TOKEN / TOKEN_INVALID / TOKEN_EXPIRED | 401; missing/invalid/expired Bearer |
| SESSION_INVALID | 401; refresh expired/revoked/reused or csrf mismatch |
| SESSION_IDLE_EXPIRED | 401; browser family exceeded its inactivity deadline; revoked and audited, explicit activity cannot revive it |
| SESSION_ABSOLUTE_EXPIRED | 401; browser family reached its fixed maximum lifetime since login; revoked and audited, fresh login required |
| CSRF_REJECTED | 403; cookie request not verified |
| FORBIDDEN / RAW_PAYLOAD_DENIED | 403; permission insufficient |
| IDEMPOTENCY_KEY_REQUIRED / INVALID_IDEMPOTENCY_KEY | 400; required key absent or malformed |
| IDEMPOTENCY_CONFLICT | 409; channel key already used with different request hash |
| MESSAGE_IN_PROGRESS | 409; duplicate work still processing |
| REVISION_CONFLICT | 409; expected active revision is stale |
| REVISION_ALREADY_PUBLISHED / ROLLBACK_UNAVAILABLE / ARCHIVE_UNAVAILABLE | 409; lifecycle conflict |
| CHANNEL_HAS_MESSAGES | 409; retained message history prevents permanent deletion; use Archive |
| CHANNEL_HAS_PENDING_WORK | 409; resolve active/queued/retrying/leased work before archive |
| DRAFT_SUPERSEDED | 409; a newer draft exists; review the latest draft |
| PAYLOAD_SCHEMA_REJECTED / HL7_PROFILE_REJECTED / PAYLOAD_VALIDATION_REJECTED | 422; channel profile rejected payload |
| INVALID_JSON_SCHEMA / UNSUPPORTED_JSON_SCHEMA | 400; schema invalid or unsupported costly/reference keywords |
| INVALID_JSON | 400; incoming JSON text cannot be parsed |
| JSON_INVALID | 422; basic validation received a non-JSON value or exceeded the payload limit |
| MESSAGE_PROCESSING_FAILED | 502; persisted processing outcome is failed/partial; messageId/status and the legacy result remain available for reconciliation |
| ENCRYPTION_KEY_UNAVAILABLE | 500; current/previous keyring cannot authenticate record |
| INBOUND_CAPACITY | 503 + Retry-After; bounded source capacity reached |
| RATE_LIMITED | 429 + Retry-After; authentication, management or unsuccessful source requests exceeded the per-IP process-local limit |
| DELIVERY_LEASE_LOST | 409; old worker cannot overwrite a new delivery claim |
| DEAD_LETTER_UNAVAILABLE / RESEND_UNAVAILABLE | 409; operation not valid for message state |
| INVALID_ASSIGNEE | 400; assignment requires existing operator/admin |
| DESTINATION_HOST_DENIED / DESTINATION_ADDRESS_DENIED | 403; outbound policy |
| FIELD_VALIDATION_FAILED | 422; input field rules rejected the payload, safe details contain field/type/reason only, IN-ERROR and no delivery |
| INVALID_FIELD_RULES / INVALID_VALIDATION_PROFILE / VALIDATION_FORMAT_UNSUPPORTED | 400; incomplete/unsupported rule configuration or incompatible input format, never treated as payload success |
| FILTER_CONFIG_INVALID | 422; corrupted reserved source/destination filter metadata; source fails IN-ERROR, destination fails preparation without delivery |
| FILTER_RESULT_INVALID | 422; an enabled filter returned a non-Boolean value; no delivery for the affected source/destination |
| DESTINATION_NOT_PREPARED | 409; retry/resend cannot verify a saved final body, or historical evidence indicates preparation failed; reconcile before submitting a new message |
| INVALID_DELIVERY_SNAPSHOT | 409; saved connector cannot be decrypted or parsed; no resend occurs |
| FIELD_DISCOVERY_INVALID | 400; unsupported format, missing sample or invalid discovery request shape |
| FIELD_DISCOVERY_FAILED / SAMPLE_INVALID | 422; sample parsing/source transformation could not produce a safe field explorer; no destination was contacted |
| FIELD_MAPPING_CONFIG_INVALID | 422; altered/noncanonical reserved V2 generated mapping metadata or body is rejected before sandbox execution or delivery; restore/recompile the mapping or replace it with a complete custom transformation script |
| FIELD_MAPPING_REQUIRED | 422; a configured source path is missing/empty after applying its default, with safe source/target path guidance |
| FIELD_MAPPING_CONVERSION | 422; explicit number/Boolean/date conversion failed; guidance states the expected conversion without returning the value |
| FIELD_MAPPING_TARGET / FIELD_MAPPING_RESULT_INVALID / FIELD_MAPPING_FAILED | 422; conflicting target structure, invalid generated result envelope or bounded mapping failure |
| HL7_PROFILE_REQUIRED / HL7_PROFILE_DATE / HL7_PROFILE_CODE / HL7_PROFILE_IDENTIFIER | 422; generated v2.5 message violates a selected curated profile field/date/code/identifier rule; safe configured HL7 field guidance |
| HTTP_CONFIG_INVALID | 422 diagnostic; method/header/content-type configuration invalid or incompatible with outbound format; no HTTP request or automatic retry |
| DESTINATION_CREDENTIAL_MISSING | 422 diagnostic; the destination-scoped environment credential is absent, oversized or contains forbidden control characters; values are never returned |
| SCRIPT_TIMEOUT / SCRIPT_EXECUTION_FAILED / SCRIPT_CAPACITY | sandbox/time/capacity diagnostic |
| TRANSFORMATION_PREVIEW_INVALID / DRY_RUN_INVALID | 400; invalid test configuration identifies the affected source/destination setting without echoing input |
| PAYLOAD_TOO_LARGE / UPLOAD_LIMIT | body/upload exceeded bound |
| INTERNAL_ERROR | 500; internal details withheld |

Delivery diagnostics such as DELIVERY_OUTCOME_UNKNOWN, DESTINATION_CIRCUIT_OPEN, DELIVERY_CAPACITY and RESPONSE_SCRIPT_FAILED_AFTER_DELIVERY appear in message metadata. Response-script failure after accepted delivery never triggers automatic network resend. TCP_WRITE_COMPLETE means socket write completed; it does not prove application acceptance.

Destination preparation uses the existing OUT-ERROR state and a bounded internal `last_error` diagnostic: `DESTINATION_FILTER_ERROR:<CODE>`, `DESTINATION_TRANSFORM_ERROR:<CODE>`, `DESTINATION_TEMPLATE_ERROR:<CODE>` or `DESTINATION_CONVERSION_ERROR:<CODE>`. Message detail projects the stage and safe code through `destinationOutcomes`; it never returns script exceptions or payload values as error guidance. These preparation outcomes create no transport attempt log or retry. FILTERED is a non-delivery decision, and disabled destinations run no preparation stage.

`HTTP_400`–`HTTP_499` other than `HTTP_408`/`HTTP_429` are permanent delivery failures and stop automatic retry. HTTP 408/429 and 5xx use the configured retry limits. A transport timeout can be reported as `DESTINATION_TIMEOUT` or the safe Axios code `ECONNABORTED`; uncertain transport outcomes are quarantined as DEAD_LETTER rather than automatically repeated. HTTP response status and duration are recorded only when observed.

Known local HTTP configuration/credential and endpoint-policy failures are DELIVERY_REJECTION events with `networkAttempted=false`, no HTTP status and no transport duration. Their safe codes may be retained in destination metadata while the inbound HTTP request reports its existing aggregate MESSAGE_PROCESSING_FAILED envelope; a diagnostic's originating status is not an invented response from the destination. Dry-run does not resolve credential environment values and cannot verify receiver authentication.


Follow-up operational control errors:

| Code | HTTP | Meaning |
| --- | --- | --- |
| DRAFT_CONFLICT | 409 | Stale checksum or draft no longer editable; reload revisions |
| INVALID_DESTINATION_INDEX | 400 | Probe index outside 0–49 |
| DESTINATION_NOT_FOUND | 404 | Stored revision lacks the selected destination or runtime destination retired |
| CONNECTION_TEST_CAPACITY | 503 | Four connection probes already active in this process |
| CONNECTION_TEST_TIMEOUT | 504 | Bounded destination handshake expired |
| CONNECTION_TEST_FAILED | 502 | TCP connection refused/closed/failed; no application message sent |
| CONNECTION_TLS_FAILED | 502 | TLS connection or certificate/hostname verification failed |
| CIRCUIT_RESET_BUSY | 409 | Active destination delivery slots prevent a safe reset |
| JSON_STRUCTURE_LIMIT | 422 | JSON nesting exceeds 100 before canonical hashing |
| INVALID_XML_PROFILE | 400 | Profile uses unsupported literal path/rule structure |
| XML_INVALID | 422 | Malformed/non-string XML or structural/size limits exceeded |
| XML_PROFILE_REJECTED | 422 | Root, required text path or allowed-value rule rejected payload |
| XML_ENTITIES_DENIED | 422 | XML DTD/entity declarations are denied |
| FILTER_INPUT_INVALID / FIELD_MAPPING_INPUT_INVALID | 422 | Generated filter/mapping XML input is invalid or exceeds structural limits |
| SCRIPT_MEMORY_LIMIT | 422 | QuickJS memory exhaustion; exception content is not returned |

Canonical-key conflicts continue to use IDEMPOTENCY_CONFLICT. XML rules use literal dotted element names; XPath expressions/attributes/XSD are not implemented.

Review previews return failed-stage `code` plus safe actionable `message` metadata. An intact visual mapping with a missing required field can report `Target field PatientID is required.` using its configured target path. Validation/filter ordering and defaults are preserved; raw exception messages and patient values are never used as guidance. Malformed JSON test input is rejected locally in Review before an API request.
