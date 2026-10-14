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
| ENCRYPTION_KEY_UNAVAILABLE | 500; current/previous keyring cannot authenticate record |
| INBOUND_CAPACITY | 503 + Retry-After; bounded source capacity reached |
| DELIVERY_LEASE_LOST | 409; old worker cannot overwrite a new delivery claim |
| DEAD_LETTER_UNAVAILABLE / RESEND_UNAVAILABLE | 409; operation not valid for message state |
| INVALID_ASSIGNEE | 400; assignment requires existing operator/admin |
| DESTINATION_HOST_DENIED / DESTINATION_ADDRESS_DENIED | 403; outbound policy |
| SCRIPT_TIMEOUT / SCRIPT_EXECUTION_FAILED / SCRIPT_CAPACITY | sandbox/time/capacity diagnostic |
| PAYLOAD_TOO_LARGE / UPLOAD_LIMIT | body/upload exceeded bound |
| INTERNAL_ERROR | 500; internal details withheld |

Delivery diagnostics such as DELIVERY_OUTCOME_UNKNOWN, DESTINATION_CIRCUIT_OPEN, DELIVERY_CAPACITY and RESPONSE_SCRIPT_FAILED_AFTER_DELIVERY appear in message metadata. Response-script failure after accepted delivery never triggers automatic network resend. TCP_WRITE_COMPLETE means socket write completed; it does not prove application acceptance.
