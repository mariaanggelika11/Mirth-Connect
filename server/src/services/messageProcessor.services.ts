import { serialize, convertPayload } from './engine/conversion.js';
import { attempt } from './engine/delivery.js';
import { recordAttempt, updateAggregate } from './engine/repository.js';
export { finalStatus, retryDecision } from './engine/policy.js';
export { updateAggregate } from './engine/repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { getConnection, withTransaction } from '../config/db.js';
import { executeScript } from './script.services.js';
import { hl7ToJson, parseSegments } from '../utils/hl7Converer.js';
import { AppError, safeError } from '../utils/errors.js';
import { encrypt, decrypt } from '../utils/secrets.js';
import { logger } from '../utils/logger.js';
import type { Destination } from '../models/Destination.js';
import type { Channel } from '../models/Channel.js';
import type { StoredMessage } from '../models/Message.js';
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
        outbound = await convertPayload(outbound, dest.outbound_data_type);
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
