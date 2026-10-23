import { AppError } from '../../utils/errors.js';
import { decrypt } from '../../utils/secrets.js';
import { getConnection, type DatabaseTransaction } from '../../config/db.js';
import type { Destination } from '../../models/Destination.js';
import type { StoredMessage } from '../../models/Message.js';

export type PreparationStage = 'filter' | 'transformation' | 'template' | 'conversion';
const stages = {
  FILTER: 'filter',
  TRANSFORM: 'transformation',
  TEMPLATE: 'template',
  CONVERSION: 'conversion',
} as const;
export function preparationFailure(stage: PreparationStage, code: string) {
  const name = Object.entries(stages).find(([, value]) => value === stage)![0];
  return `DESTINATION_${name}_ERROR:${/^[A-Z0-9_]{1,50}$/.test(code) ? code : 'PROCESSING_ERROR'}`;
}
export function preparationFailureDetails(error?: string) {
  const match = /^DESTINATION_(FILTER|TRANSFORM|TEMPLATE|CONVERSION)_ERROR:([A-Z0-9_]{1,50})$/.exec(
    error || '',
  );
  return match ? { stage: stages[match[1] as keyof typeof stages], code: match[2] } : undefined;
}
export function legacyPreparationFailure(error?: string) {
  return (
    !!error &&
    /^(?:SCRIPT_|FIELD_MAPPING_|FILTER_|XML_|INVALID_HL7(?:_|$)|INVALID_DESTINATION_PREPARATION|DESTINATION_NOT_PREPARED)/.test(
      error,
    )
  );
}
/** A saved connector alone does not prove its payload finished preparation in older releases. */
export async function preparedDestination(
  message: StoredMessage & { last_error?: string },
  tx?: DatabaseTransaction,
): Promise<Destination> {
  if (
    !message.transport_config ||
    preparationFailureDetails(message.last_error) ||
    legacyPreparationFailure(message.last_error)
  )
    throw new AppError(
      409,
      'DESTINATION_NOT_PREPARED',
      'This message has no verified final payload. Correct the channel and submit a new message.',
    );
  let destination: Destination & { preparation_version?: number };
  try {
    destination = JSON.parse(decrypt(message.transport_config));
    if (!destination || typeof destination !== 'object' || typeof destination.endpoint !== 'string')
      throw new Error();
  } catch {
    throw new AppError(
      409,
      'INVALID_DELIVERY_SNAPSHOT',
      'The saved delivery configuration is unavailable. Reconcile this message before resending.',
    );
  }
  if (destination.preparation_version === 1) return destination;
  // QUEUED was written only by delivery admission/transport after the final payload was stored.
  if (message.status === 'QUEUED') return destination;
  const pool = tx || (await getConnection());
  const evidence = (
    await pool
      .request()
      .input('id', message.id)
      .query(
        `SELECT EXISTS(SELECT 1 FROM "MessageDestinationLog" WHERE message_id=@id AND (request_duration_ms IS NOT NULL OR http_status IS NOT NULL OR ack_code IN ('AA','AE','AR') OR response_text ~ '^(HTTP_[1-5][0-9]{2}|DESTINATION_(CIRCUIT_OPEN|TIMEOUT|HOST_DENIED|ADDRESS_DENIED)|DELIVERY_(CAPACITY|ALREADY_ACTIVE)|ECONN(ABORTED|RESET|REFUSED)|ETIMEDOUT|EPIPE|ACK_MISSING|INVALID_ACK|HL7_NACK_(AE|AR)|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$')) prepared`,
      )
  ).recordset[0]?.prepared;
  if (evidence !== true)
    throw new AppError(
      409,
      'DESTINATION_NOT_PREPARED',
      'The final payload of this historical message cannot be verified. Reconcile it before submitting a new message.',
    );
  return destination;
}
