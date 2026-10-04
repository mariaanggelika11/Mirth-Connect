import { randomUUID, createHash } from 'node:crypto';
import { getConnection, withTransaction } from '../config/db.js';
import { executeScript } from './script.services.js';
import { jsonToHl7, hl7ToJson, parseSegments } from '../utils/hl7Converer.js';
import { Builder, parseStringPromise } from 'xml2js';
import { sendRest, sendTcp } from '../utils/transport.js';
import { AppError, safeError } from '../utils/errors.js';
import { encrypt, decrypt } from '../utils/secrets.js';
import { logger } from '../utils/logger.js';
import type { Destination } from '../models/Destination.js';
import type { Channel } from '../models/Channel.js';
import type { StoredMessage, InboundStatus, OutboundStatus } from '../models/Message.js';
export function finalStatus(statuses: string[]): InboundStatus {
  if (!statuses.length) return 'RECEIVED';
  if (statuses.every((s) => s === 'FILTERED')) return 'FILTERED';
  if (statuses.some((s) => ['PROCESSING', 'QUEUED', 'RETRYING'].includes(s))) return 'QUEUED';
  const sent = statuses.filter((s) => s === 'OUT-SENT').length;
  const failed = statuses.filter((s) => ['OUT-ERROR', 'DEAD_LETTER'].includes(s)).length;
  return failed === 0 ? 'SUCCESS' : sent > 0 ? 'PARTIAL' : 'FAILED';
}
export function retryDecision(
  dest: Pick<Destination, 'retry_enabled' | 'max_retries' | 'retry_interval_seconds'>,
  retryCount: number,
) {
  return dest.retry_enabled && retryCount < dest.max_retries
    ? {
        status: 'QUEUED' as OutboundStatus,
        delay: Math.min(86400, dest.retry_interval_seconds * 2 ** retryCount),
      }
    : {
        status: dest.retry_enabled
          ? ('DEAD_LETTER' as OutboundStatus)
          : ('OUT-ERROR' as OutboundStatus),
        delay: null,
      };
}
function serialize(value: unknown) {
  return JSON.stringify(value ?? null);
}
async function convert(value: unknown, type: string): Promise<unknown> {
  if (type === 'HL7V2') {
    const raw = typeof value === 'string' ? value : jsonToHl7(value);
    parseSegments(raw);
    return raw;
  }
  if (type === 'JSON') {
    if (typeof value !== 'string') return value;
    if (value.startsWith('MSH')) return hl7ToJson(value);
    if (value.trim().startsWith('<')) return parseStringPromise(value, { explicitArray: false });
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }
  if (type === 'XML')
    return typeof value === 'string' && value.trim().startsWith('<')
      ? value
      : new Builder({ headless: true }).buildObject(
          typeof value === 'string' ? { raw: value } : value,
        );
  return typeof value === 'string' ? value : serialize(value);
}
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
async function recordAttempt(
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
async function attempt(message: StoredMessage, dest: Destination, retryCount: number) {
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
export async function processInboundMessage(
  channelId: number,
  payload: unknown,
  correlationId: string = randomUUID(),
) {
  const pool = await getConnection();
  const channel = (
    await pool.request().input('id', channelId).query('SELECT * FROM "Channels" WHERE id=@id')
  ).recordset[0] as Channel | undefined;
  if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
  if (channel.status !== 'RUNNING')
    throw new AppError(409, 'CHANNEL_STOPPED', 'Channel is not running');
  let dedupe: string | null = null;
  if (channel.inbound_data_type === 'HL7V2') {
    try {
      const msh = parseSegments(String(payload)).segments[0].fields;
      dedupe = createHash('sha256')
        .update(serialize([msh[3], msh[4], msh[10]]))
        .digest('hex');
    } catch {
      /* invalid inbound is persisted below before validation */
    }
  }
  const reserved = await withTransaction(async (tx) => {
    if (dedupe) {
      await tx
        .request()
        .input('key', channelId + ':' + dedupe)
        .query('SELECT pg_advisory_xact_lock(hashtextextended(@key,0))');
      const existing = (
        await tx
          .request()
          .input('channel', channelId)
          .input('dedupe', dedupe)
          .query(
            'SELECT id,status FROM "Messages" WHERE channel_id=@channel AND dedupe_key=@dedupe FOR UPDATE',
          )
      ).recordset[0];
      if (existing)
        return { id: existing.id as number, status: String(existing.status), duplicate: true };
    }
    const row = (
      await tx
        .request()
        .input('channel', channelId)
        .input('type', channel.inbound_data_type)
        .input('payload', serialize(payload))
        .input('correlation', correlationId)
        .input('dedupe', dedupe)
        .query(
          `INSERT INTO "Messages"(channel_id,direction,message_type,original_payload,status,correlation_id,dedupe_key,lease_until,created_at) VALUES(@channel,'IN',@type,@payload,'IN-PROCESS',@correlation,@dedupe,(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\'),CURRENT_TIMESTAMP) RETURNING id`,
        )
    ).recordset[0];
    return { id: row.id as number, status: 'IN-PROCESS', duplicate: false };
  });
  const inboundMessageId = reserved.id;
  if (reserved.duplicate) {
    if (reserved.status === 'IN-PROCESS')
      throw new AppError(
        409,
        'MESSAGE_IN_PROGRESS',
        'Message with this control ID is already processing',
      );
    return {
      success: !['IN-ERROR', 'FAILED', 'PARTIAL'].includes(reserved.status),
      duplicate: true,
      inboundMessageId,
      inboundStatus: reserved.status,
      outboundResults: [],
    };
  }
  let transformed = payload;
  const heartbeat = setInterval(() => {
    void pool
      .request()
      .input('id', inboundMessageId)
      .query(
        "UPDATE \"Messages\" SET lease_until=(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\') WHERE (inbound_message_id=@id AND status='PROCESSING') OR (id=@id AND status='IN-PROCESS')",
      )
      .catch(() =>
        logger.error(
          { messageId: inboundMessageId, code: 'LEASE_REFRESH_FAILED' },
          'Lease refresh failed',
        ),
      );
  }, 30000);
  try {
    if (channel.inbound_data_type === 'HL7V2') parseSegments(String(payload));
    if (
      channel.filter_script?.trim() &&
      !(await executeScript(
        channel.filter_script,
        { msg: channel.inbound_data_type === 'HL7V2' ? hl7ToJson(String(payload)) : payload },
        'true',
      ))
    ) {
      await pool
        .request()
        .input('id', inboundMessageId)
        .query(
          'UPDATE "Messages" SET status=\'FILTERED\',updated_at=CURRENT_TIMESTAMP WHERE id=@id',
        );
      return { success: true, inboundMessageId, inboundStatus: 'FILTERED', outboundResults: [] };
    }
    if (channel.processing_script?.trim())
      transformed = await executeScript(channel.processing_script, { msg: payload });
    await pool
      .request()
      .input('id', inboundMessageId)
      .input('payload', serialize(transformed))
      .query(
        'UPDATE "Messages" SET transformed_payload=@payload,updated_at=CURRENT_TIMESTAMP WHERE id=@id',
      );
    const destinations = (
      await pool
        .request()
        .input('id', channelId)
        .query(
          'SELECT * FROM "Destinations" WHERE channel_id=@id AND is_enabled=true AND is_deleted=false ORDER BY id',
        )
    ).recordset as Destination[];
    // Reserve ALL outbound records before any side effects. A crash leaves explicit PROCESSING states.
    const jobs = await withTransaction(async (tx) => {
      const jobs: { message: StoredMessage; dest: Destination }[] = [];
      for (const dest of destinations) {
        const row = (
          await tx
            .request()
            .input('channel', channelId)
            .input('dest', dest.id)
            .input('parent', inboundMessageId)
            .input('type', dest.outbound_data_type)
            .input('payload', serialize(transformed))
            .input('correlation', correlationId)
            .input('snapshot', encrypt(serialize(dest)))
            .query(
              `INSERT INTO "Messages"(channel_id,destination_id,inbound_message_id,direction,message_type,original_payload,transformed_payload,status,correlation_id,transport_config,lease_until,created_at) VALUES(@channel,@dest,@parent,'OUT',@type,@payload,@payload,'PROCESSING',@correlation,@snapshot,(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\'),CURRENT_TIMESTAMP) RETURNING *`,
            )
        ).recordset[0] as StoredMessage;
        jobs.push({ message: row, dest });
      }
      return jobs;
    });
    const outboundResults = [];
    for (const { message, dest } of jobs) {
      let outbound = structuredClone(transformed);
      try {
        if (
          dest.filter_script?.trim() &&
          !(await executeScript(dest.filter_script, { msg: outbound }, 'true'))
        ) {
          await recordAttempt(message, dest, 'FILTERED', 'FILTERED', null, null, 0);
          outboundResults.push({
            destinationId: dest.id,
            outboundMessageId: message.id,
            status: 'FILTERED',
          });
          continue;
        }
        if (dest.processing_script?.trim())
          outbound = await executeScript(dest.processing_script, { msg: outbound });
        if (dest.template_script?.trim())
          outbound = await executeScript(dest.template_script, { msg: outbound });
        outbound = await convert(outbound, dest.outbound_data_type);
      } catch (error) {
        await recordAttempt(
          message,
          dest,
          'OUT-ERROR',
          safeError(error),
          safeError(error),
          null,
          0,
        );
        outboundResults.push({
          destinationId: dest.id,
          outboundMessageId: message.id,
          status: 'OUT-ERROR',
        });
        continue;
      }
      message.transformed_payload = serialize(outbound);
      await pool
        .request()
        .input('id', message.id)
        .input('payload', message.transformed_payload)
        .query('UPDATE "Messages" SET transformed_payload=@payload WHERE id=@id');
      outboundResults.push(await attempt(message, dest, 0));
    }
    const inboundStatus = await updateAggregate(inboundMessageId);
    const response = channel.response_script?.trim()
      ? await executeScript(
          channel.response_script,
          {
            msg: transformed,
            response: serialize({ inboundMessageId, inboundStatus, outboundResults }),
          },
          'response',
        )
      : undefined;
    return {
      response,
      success: !['FAILED', 'PARTIAL', 'IN-ERROR'].includes(inboundStatus),
      inboundMessageId,
      channelId,
      inboundStatus,
      outboundResults,
    };
  } catch (error) {
    await pool
      .request()
      .input('id', inboundMessageId)
      .input('error', safeError(error))
      .query(
        'UPDATE "Messages" SET status=\'IN-ERROR\',last_error=@error,updated_at=CURRENT_TIMESTAMP WHERE id=@id',
      );
    logger.error(
      { messageId: inboundMessageId, channelId, code: safeError(error) },
      'Inbound processing failed',
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
export async function processRetry(message: StoredMessage) {
  const dest = JSON.parse(decrypt(message.transport_config)) as Destination;
  const result = await attempt(message, dest, message.retry_count + 1);
  await updateAggregate(message.inbound_message_id);
  return result;
}
export async function resendMessage(id: number) {
  const pool = await getConnection();
  const row = (
    await pool
      .request()
      .input('id', id)
      .query(
        `UPDATE "Messages" SET status='RETRYING',lease_until=(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\') WHERE id=@id AND direction='OUT' AND status IN ('OUT-ERROR','DEAD_LETTER') AND destination_id IS NOT NULL AND transport_config IS NOT NULL AND EXISTS(SELECT 1 FROM "Channels" c WHERE c.id="Messages".channel_id AND c.status='RUNNING') RETURNING *`,
      )
  ).recordset[0] as StoredMessage | undefined;
  if (!row)
    throw new AppError(
      409,
      'RESEND_UNAVAILABLE',
      'Resend requires a failed message with a saved connector and running channel',
    );
  // Send the saved final payload once; transforms/templates are never applied twice.
  return processRetry(row);
}
