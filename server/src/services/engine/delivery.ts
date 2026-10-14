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
  return dest.response_script?.trim()
    ? String(await executeScript(dest.response_script, { msg: payload, response }, 'response'))
    : response;
}
export async function attempt(message: StoredMessage, dest: Destination, retryCount: number) {
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
  } catch (e) {
    error = safeError(e);
    response = error;
    const decision = retryDecision(dest, retryCount);
    status = decision.status;
    delay = decision.delay;
  }
  // Persisting the delivery result is mandatory: DB failure propagates instead of emitting a false ACK.
  await recordAttempt(message, dest, status, response, error, delay, retryCount);
  return {
    destinationId: dest.id,
    destinationName: dest.name,
    outboundMessageId: message.id,
    status,
  };
}
