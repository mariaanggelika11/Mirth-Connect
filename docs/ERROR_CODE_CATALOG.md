# Safe error contract

Errors return success=false, code, safe message and requestId; central handler adds details=[]. Legacy success response shapes remain. Some existing limiter responses retain their legacy minimal shape. SQL, stack, paths, credential values and raw payloads are not returned. Script/remote exceptions become diagnostic codes.

| Code | HTTP / meaning |
| --- | --- |
| NO_TOKEN / TOKEN_INVALID / TOKEN_EXPIRED | 401; missing/invalid/expired Bearer |
| SESSION_INVALID | 401; refresh expired/revoked/reused or csrf mismatch |
| CSRF_REJECTED | 403; cookie request not verified |
| FORBIDDEN / RAW_PAYLOAD_DENIED | 403; permission insufficient |
| IDEMPOTENCY_KEY_REQUIRED / INVALID_IDEMPOTENCY_KEY | 400; required key absent or malformed |
| IDEMPOTENCY_CONFLICT | 409; channel key already used with different request hash |
| MESSAGE_IN_PROGRESS | 409; duplicate work still processing |
| REVISION_CONFLICT | 409; expected active revision is stale |
| REVISION_ALREADY_PUBLISHED / ROLLBACK_UNAVAILABLE / ARCHIVE_UNAVAILABLE | 409; lifecycle conflict |
| CHANNEL_HAS_REVISIONS / CHANNEL_HAS_MESSAGES | 409; evidence must be retained |
| PAYLOAD_SCHEMA_REJECTED / HL7_PROFILE_REJECTED / PAYLOAD_VALIDATION_REJECTED | 422; channel profile rejected payload |
| INVALID_JSON_SCHEMA / UNSUPPORTED_JSON_SCHEMA | 400; schema invalid or unsupported costly/reference keywords |
| INVALID_JSON | 400; incoming JSON text cannot be parsed |
| JSON_INVALID | 422; basic validation received a non-JSON value or exceeded the payload limit |
| MESSAGE_PROCESSING_FAILED | 502; persisted processing outcome is failed/partial; messageId/status and the legacy result remain available for reconciliation |
| ENCRYPTION_KEY_UNAVAILABLE | 500; current/previous keyring cannot authenticate record |
| INBOUND_CAPACITY | 503 + Retry-After; bounded source capacity reached |
| DELIVERY_LEASE_LOST | 409; old worker cannot overwrite a new delivery claim |
| DEAD_LETTER_UNAVAILABLE / RESEND_UNAVAILABLE | 409; operation not valid for message state |
| INVALID_ASSIGNEE | 400; assignment requires existing operator/admin |
| DESTINATION_HOST_DENIED / DESTINATION_ADDRESS_DENIED | 403; outbound policy |
| SCRIPT_TIMEOUT / SCRIPT_EXECUTION_FAILED / SCRIPT_CAPACITY | sandbox/time/capacity diagnostic |
| TRANSFORMATION_PREVIEW_INVALID / DRY_RUN_INVALID | 400; invalid test configuration identifies the affected source/destination setting without echoing input |
| PAYLOAD_TOO_LARGE / UPLOAD_LIMIT | body/upload exceeded bound |
| INTERNAL_ERROR | 500; internal details withheld |

Delivery diagnostics such as DELIVERY_OUTCOME_UNKNOWN, DESTINATION_CIRCUIT_OPEN, DELIVERY_CAPACITY and RESPONSE_SCRIPT_FAILED_AFTER_DELIVERY appear in message metadata. Response-script failure after accepted delivery never triggers automatic network resend. TCP_WRITE_COMPLETE means socket write completed; it does not prove application acceptance.


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
