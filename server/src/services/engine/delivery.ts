import { observe } from '../../utils/runtimeMetrics.js';
import { acquireDelivery, releaseDelivery } from '../circuitBreaker.services.js';
import { executeScript } from '../script.services.js';
import { sendRest, sendTcp } from '../../utils/transport.js';
import { safeError } from '../../utils/errors.js';
import type { Destination } from '../../models/Destination.js';
import type { StoredMessage, OutboundStatus } from '../../models/Message.js';
import { serialize } from './conversion.js';
import { retryDecision, deliveryRejected } from './policy.js';
import { recordAttempt } from './repository.js';
import { httpDeliveryConfiguration } from './httpConfiguration.js';
async function deliver(
  dest: Destination,
  payload: unknown,
  channelId: number,
  correlationId: string,
  onHttpResponse: (status: number) => void,
): Promise<string> {
  const body = typeof payload === 'string' ? payload : serialize(payload);
  const http = dest.type === 'REST' ? httpDeliveryConfiguration(dest) : undefined;
  const response =
    dest.type === 'REST'
      ? await sendRest(
          dest.endpoint,
          body,
          {
            ...http!.headers,
            'Content-Type': http!.contentType,
            'x-channel-id': String(channelId),
            'x-destination-id': String(dest.id),
            'x-correlation-id': correlationId,
            'Idempotency-Key': correlationId + ':' + dest.id,
          },
          dest.timeout_ms,
          onHttpResponse,
          http!.method,
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
    httpStatus: number | null = null,
    requestDurationMs: number | null = null,
    status: OutboundStatus = 'OUT-SENT',
    error: string | null = null,
    delay: number | null = null;
  try {
    const payload = JSON.parse(message.transformed_payload);
    const requestStarted = performance.now();
    try {
      response = await deliver(
        dest,
        payload,
        message.channel_id,
        message.correlation_id,
        (responseStatus) => {
          httpStatus = responseStatus;
        },
      );
    } finally {
      requestDurationMs = Math.min(
        2147483647,
        Math.max(0, Math.round(performance.now() - requestStarted)),
      );
    }
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
    if (deliveryRejected(error) && httpStatus === null) requestDurationMs = null;
    response = error;
    const decision = retryDecision(dest, retryCount, error);
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
    await recordAttempt(
      message,
      dest,
      status,
      response,
      error,
      delay,
      retryCount,
      httpStatus,
      requestDurationMs,
    );
  } finally {
    await releaseDelivery(
      message.id,
      dest.id,
      slot.owner,
      status === 'OUT-SENT',
      dest.delivery_policy,
    );
    if (requestDurationMs !== null)
      observe('destination_request_seconds', (performance.now() - started) / 1000);
  }
  return {
    destinationId: dest.id,
    destinationName: dest.name,
    outboundMessageId: message.id,
    status,
  };
}
