import { observe } from '../../utils/runtimeMetrics.js';
import { acquireDelivery, releaseDelivery } from '../circuitBreaker.services.js';
import { executeScript } from '../script.services.js';
import { sendRest, sendTcp } from '../../utils/transport.js';
import { safeError } from '../../utils/errors.js';
import type { Destination } from '../../models/Destination.js';
import type { StoredMessage, OutboundStatus } from '../../models/Message.js';
import { serialize } from './conversion.js';
import { retryDecision } from './policy.js';
import { recordAttempt } from './repository.js';
async function deliver(
  dest: Destination,
  payload: unknown,
  channelId: number,
  correlationId: string,
): Promise<string> {
  const body = typeof payload === 'string' ? payload : serialize(payload);
  const response =
    dest.type === 'REST'
      ? await sendRest(
          dest.endpoint,
          body,
          {
            'Content-Type':
              dest.outbound_data_type === 'HL7V2'
                ? 'application/hl7-v2'
                : dest.outbound_data_type === 'XML'
                  ? 'application/xml'
                  : 'application/json',
            'x-channel-id': String(channelId),
            'x-destination-id': String(dest.id),
            'x-correlation-id': correlationId,
            'Idempotency-Key': correlationId + ':' + dest.id,
          },
          dest.timeout_ms,
        )
      : await sendTcp(dest.endpoint, body, ['HL7', 'MLLP'].includes(dest.type), dest.timeout_ms);
  return response;
}
export async function attempt(message: StoredMessage, dest: Destination, retryCount: number) {
  const started = performance.now();
  const slot = await acquireDelivery(message.id, dest.id, dest.delivery_policy);
  if (!slot.acquired) {
    await recordAttempt(message, dest, 'QUEUED', slot.reason, slot.reason, 30, message.retry_count);
    return {
      destinationId: dest.id,
      destinationName: dest.name,
      outboundMessageId: message.id,
      status: 'QUEUED' as const,
    };
  }
  let response = '',
    status: OutboundStatus = 'OUT-SENT',
    error: string | null = null,
    delay: number | null = null;
  try {
    response = await deliver(
      dest,
      JSON.parse(message.transformed_payload),
      message.channel_id,
      message.correlation_id,
    );
    if (dest.response_script?.trim()) {
      try {
        response = String(
          await executeScript(
            dest.response_script,
            { msg: JSON.parse(message.transformed_payload), response },
            'response',
          ),
        );
      } catch {
        error = 'RESPONSE_SCRIPT_FAILED_AFTER_DELIVERY';
      }
    }
  } catch (e) {
    error = safeError(e);
    response = error;
    const decision = retryDecision(dest, retryCount);
    const ambiguous = [
      'DESTINATION_TIMEOUT',
      'ACK_MISSING',
      'INVALID_ACK',
      'DELIVERY_OUTCOME_UNKNOWN',
      'ERR_BAD_RESPONSE',
      'ETIMEDOUT',
      'EPIPE',
      'ECONNABORTED',
      'ECONNRESET',
    ].includes(error);
    status = ambiguous ? 'DEAD_LETTER' : decision.status;
    delay = ambiguous ? null : decision.delay;
  }
  // Persisting the delivery result is mandatory: DB failure propagates instead of emitting a false ACK.
  try {
    await recordAttempt(message, dest, status, response, error, delay, retryCount);
  } finally {
    await releaseDelivery(
      message.id,
      dest.id,
      slot.owner,
      status === 'OUT-SENT',
      dest.delivery_policy,
    );
    observe('destination_request_seconds', (performance.now() - started) / 1000);
  }
  return {
    destinationId: dest.id,
    destinationName: dest.name,
    outboundMessageId: message.id,
    status,
  };
}
