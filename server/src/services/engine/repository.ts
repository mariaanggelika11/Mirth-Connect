import { getConnection, withTransaction } from '../../config/db.js';
import { parseSegments } from '../../utils/hl7Converer.js';
import { logger } from '../../utils/logger.js';
import type { Destination } from '../../models/Destination.js';
import type { StoredMessage, OutboundStatus } from '../../models/Message.js';
import { finalStatus } from './policy.js';
export async function recordAttempt(
  message: StoredMessage,
  dest: Destination,
  status: OutboundStatus,
  response: string,
  error: string | null,
  delay: number | null,
  retryCount: number,
) {
  await withTransaction(async (tx) => {
    await tx
      .request()
      .input('id', message.id)
      .input('status', status)
      .input('error', error)
      .input('delay', delay)
      .input('count', retryCount)
      .query(
        `UPDATE "Messages" SET status=@status,last_error=@error,retry_count=@count,last_retry_at=CASE WHEN @count>0 THEN CURRENT_TIMESTAMP ELSE last_retry_at END,next_retry_at=CASE WHEN @delay::double precision IS NULL THEN NULL ELSE (CURRENT_TIMESTAMP + (@delay)::double precision * INTERVAL \'1 second\') END,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
      );
    const ackCode = error?.startsWith('HL7_NACK_')
      ? error.slice(-2)
      : dest.type === 'HL7' || dest.type === 'MLLP'
        ? status === 'OUT-SENT'
          ? 'AA'
          : null
        : null;
    let controlId: string | null = null;
    try {
      controlId = parseSegments(JSON.parse(message.transformed_payload)).segments[0].fields[10];
    } catch {
      /* not HL7 */
    }
    await tx
      .request()
      .input('id', message.id)
      .input('dest', dest.id)
      .input('status', status === 'QUEUED' || status === 'DEAD_LETTER' ? 'OUT-ERROR' : status)
      .input('response', response)
      .input('request', message.original_payload)
      .input('outbound', message.transformed_payload)
      .input('ack', ackCode)
      .input('control', controlId)
      .query(
        `INSERT INTO "MessageDestinationLog"(message_id,destination_id,status,response_text,request_data,outbound_data,ack_code,message_control_id,sent_at) VALUES(@id,@dest,@status,@response,@request,@outbound,@ack,@control,CURRENT_TIMESTAMP)`,
      );
  });
  logger.info(
    {
      messageId: message.id,
      channelId: message.channel_id,
      destinationId: dest.id,
      status,
      errorCode: error,
    },
    'Destination attempt completed',
  );
}
export async function updateAggregate(inboundId: number) {
  const pool = await getConnection();
  const rows = (
    await pool
      .request()
      .input('id', inboundId)
      .query(`SELECT status FROM "Messages" WHERE inbound_message_id=@id AND direction='OUT'`)
  ).recordset;
  const status = finalStatus(rows.map((r) => r.status));
  await pool
    .request()
    .input('id', inboundId)
    .input('status', status)
    .query('UPDATE "Messages" SET status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@id');
  return status;
}
