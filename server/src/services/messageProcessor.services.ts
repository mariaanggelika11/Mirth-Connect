import { serialize, convertPayload } from './engine/conversion.js';
import { persistValidationFailure } from '../utils/validationDiagnostics.js';
import { validatePayload, FieldValidationError } from './profileValidation.services.js';
import { attempt } from './engine/delivery.js';
import { recordPreparation, updateAggregate } from './engine/repository.js';
import {
  preparationFailure,
  preparedDestination,
  type PreparationStage,
} from './engine/preparation.js';
export { finalStatus, retryDecision } from './engine/policy.js';
export { updateAggregate } from './engine/repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { getConnection, withTransaction } from '../config/db.js';
import { executeScript } from './script.services.js';
import { hl7ToJson, parseSegments } from '../utils/hl7Converer.js';
import { AppError, safeError } from '../utils/errors.js';
import { encrypt } from '../utils/secrets.js';
import { increment, observe, gauge } from '../utils/runtimeMetrics.js';
import { config } from '../config/env.js';
import { requestDigest, releasableReservation } from '../utils/idempotency.js';
import { logger } from '../utils/logger.js';
import type { Destination } from '../models/Destination.js';
import type { Channel } from '../models/Channel.js';
import type { StoredMessage } from '../models/Message.js';
let activeInbound = 0;
export async function processInboundMessage(
  channelId: number,
  payload: unknown,
  correlationId: string = randomUUID(),
  idempotencyKey?: string,
  expectedSource?: string,
  expectedRevision?: number,
) {
  if (activeInbound >= config.server.maxActiveInbound)
    throw new AppError(503, 'INBOUND_CAPACITY', 'Inbound processing capacity exceeded');
  activeInbound++;
  gauge('inbound_workers_active', activeInbound);
  try {
    return await processInboundCore(
      channelId,
      payload,
      correlationId,
      idempotencyKey,
      expectedSource,
      expectedRevision,
    );
  } finally {
    activeInbound--;
    gauge('inbound_workers_active', activeInbound);
  }
}
async function processInboundCore(
  channelId: number,
  payload: unknown,
  correlationId: string = randomUUID(),
  idempotencyKey?: string,
  expectedSource?: string,
  expectedRevision?: number,
) {
  const started = performance.now();
  increment('inbound_attempts_total');
  const pool = await getConnection();
  const snapshot = await withTransaction(async (tx) => {
    const channel = (
      await tx
        .request()
        .input('id', channelId)
        .query('SELECT * FROM "Channels" WHERE id=@id FOR SHARE')
    ).recordset[0] as Channel | undefined;
    const destinations = (
      await tx
        .request()
        .input('id', channelId)
        .query(
          'SELECT * FROM "Destinations" WHERE channel_id=@id AND is_enabled=true AND is_deleted=false ORDER BY id',
        )
    ).recordset as Destination[];
    return { channel, destinations };
  });
  const channel = snapshot.channel;
  if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
  if (expectedSource && channel.source_type !== expectedSource)
    throw new AppError(
      409,
      'SOURCE_TYPE_MISMATCH',
      'Channel source changed; retry after reviewing configuration',
    );
  if (expectedRevision !== undefined && channel.active_revision !== expectedRevision)
    throw new AppError(
      409,
      'CHANNEL_REVISION_CHANGED',
      'Channel revision changed before acceptance; retry with the current configuration',
    );
  if (channel.status !== 'RUNNING')
    throw new AppError(409, 'CHANNEL_STOPPED', 'Channel is not running');
  const mode = channel.idempotency_mode || config.inbound.idempotencyMode;
  if (mode === 'REQUIRED' && !idempotencyKey && channel.source_type !== 'HL7')
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required');
  if (idempotencyKey && !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey))
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key');
  const requestHash = requestDigest(payload, channel.inbound_data_type === 'JSON');
  let dedupe: string | null =
    idempotencyKey && mode !== 'DISABLED'
      ? createHash('sha256')
          .update('http:' + idempotencyKey)
          .digest('hex')
      : null;
  if (!dedupe && channel.inbound_data_type === 'HL7V2') {
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
    // Serialize acceptance against stop/delete/archive/publish. A snapshot alone is not a reservation.
    const current = (
      await tx
        .request()
        .input('id', channelId)
        .query('SELECT * FROM "Channels" WHERE id=@id FOR SHARE')
    ).recordset[0] as Channel | undefined;
    if (!current) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
    if (current.status !== 'RUNNING')
      throw new AppError(409, 'CHANNEL_STOPPED', 'Channel is not running');
    if (current.active_revision !== channel.active_revision)
      throw new AppError(
        409,
        'CHANNEL_REVISION_CHANGED',
        'Channel revision changed before acceptance; retry with the current configuration',
      );
    if (dedupe) {
      await tx
        .request()
        .input('key', channelId + ':' + dedupe)
        .query('SELECT pg_advisory_xact_lock(hashtextextended(@key,0))');
      const expired = await tx
        .request()
        .input('channel', channelId)
        .input('dedupe', dedupe)
        .query(
          `UPDATE "Messages" SET dedupe_key=NULL WHERE channel_id=@channel AND dedupe_key=@dedupe AND ${releasableReservation} RETURNING id`,
        );
      increment('idempotency_expired_total', expired.recordset.length);
      const existing = (
        await tx
          .request()
          .input('channel', channelId)
          .input('dedupe', dedupe)
          .query(
            'SELECT id,status,request_hash,canonical_request_hash,original_payload FROM "Messages" WHERE channel_id=@channel AND dedupe_key=@dedupe FOR UPDATE',
          )
      ).recordset[0];
      // Legacy rows used order-sensitive JSON hashes. Compare their stored payload without
      // rewriting evidence or treating the same JSON with different key order as a conflict.
      let matchesLegacy = false;
      if (
        existing &&
        channel.inbound_data_type === 'JSON' &&
        typeof existing.original_payload === 'string'
      ) {
        try {
          matchesLegacy =
            requestDigest(JSON.parse(existing.original_payload), true) === requestHash;
        } catch {
          /* corrupt legacy evidence fails closed */
        }
      }
      if (
        existing &&
        (existing.canonical_request_hash || existing.request_hash) &&
        (existing.canonical_request_hash || existing.request_hash) !== requestHash &&
        !matchesLegacy
      ) {
        increment('idempotency_conflicts_total');
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different payload',
        );
      }
      if (existing)
        return { id: existing.id as number, status: String(existing.status), duplicate: true };
    }
    await tx.request().query('SELECT pg_advisory_xact_lock(741203,4)');
    const pending =
      (
        await tx
          .request()
          .query(
            `SELECT COUNT(*) total FROM "Messages" WHERE status IN ('IN-PROCESS','PROCESSING','QUEUED','RETRYING')`,
          )
      ).recordset[0]?.total || 0;
    if (pending >= config.server.maxPendingMessages)
      throw new AppError(503, 'INBOUND_CAPACITY', 'Pending message capacity exceeded');
    const row = (
      await tx
        .request()
        .input('channel', channelId)
        .input('type', channel.inbound_data_type)
        .input('payload', serialize(payload))
        .input('correlation', correlationId)
        .input('dedupe', dedupe)
        // Retain the legacy digest for readers from the previous deployment during rollback.
        .input('hash', createHash('sha256').update(serialize(payload)).digest('hex'))
        .input('canonicalHash', requestHash)
        .input('keyHash', idempotencyKey && mode !== 'DISABLED' ? dedupe : null)
        .input(
          'ttlHours',
          idempotencyKey && mode !== 'DISABLED' ? config.inbound.idempotencyRetentionHours : 0,
        )
        .input('revision', channel.active_revision || null)
        .query(
          `INSERT INTO "Messages"(channel_id,direction,message_type,original_payload,status,correlation_id,dedupe_key,idempotency_key_hash,dedupe_expires_at,request_hash,canonical_request_hash,channel_revision,lease_until,created_at) VALUES(@channel,'IN',@type,@payload,'IN-PROCESS',@correlation,@dedupe,@keyHash,CASE WHEN @ttlHours>0 THEN CURRENT_TIMESTAMP+@ttlHours::double precision*INTERVAL '1 hour' ELSE NULL END,@hash,@canonicalHash,@revision,(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\'),CURRENT_TIMESTAMP) RETURNING id`,
        )
    ).recordset[0];
    return { id: row.id as number, status: 'IN-PROCESS', duplicate: false };
  });
  const inboundMessageId = reserved.id;
  if (reserved.duplicate) {
    increment('idempotency_hits_total');
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
    await validatePayload(
      payload,
      channel.inbound_data_type,
      JSON.parse(channel.validation_profile || '{}'),
    );
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
    const destinations = snapshot.destinations;
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
            .input('revision', channel.active_revision || null)
            .query(
              `INSERT INTO "Messages"(channel_id,destination_id,inbound_message_id,direction,message_type,original_payload,transformed_payload,status,correlation_id,transport_config,channel_revision,lease_until,created_at) VALUES(@channel,@dest,@parent,'OUT',@type,@payload,@payload,'PROCESSING',@correlation,NULL,@revision,(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\'),CURRENT_TIMESTAMP) RETURNING *`,
            )
        ).recordset[0] as StoredMessage;
        jobs.push({ message: row, dest });
      }
      return jobs;
    });
    const outboundResults = [];
    for (const { message, dest } of jobs) {
      let outbound = structuredClone(transformed);
      let stage: PreparationStage = 'filter';
      try {
        if (
          dest.filter_script?.trim() &&
          !(await executeScript(dest.filter_script, { msg: outbound }, 'true'))
        ) {
          await recordPreparation(message, dest, 'FILTERED', null);
          outboundResults.push({
            destinationId: dest.id,
            outboundMessageId: message.id,
            status: 'FILTERED',
          });
          continue;
        }
        stage = 'transformation';
        if (dest.processing_script?.trim())
          outbound = await executeScript(dest.processing_script, { msg: outbound });
        stage = 'template';
        if (dest.template_script?.trim())
          outbound = await executeScript(dest.template_script, { msg: outbound });
        stage = 'conversion';
        outbound = await convertPayload(outbound, dest.outbound_data_type);
      } catch (error) {
        await recordPreparation(
          message,
          dest,
          'OUT-ERROR',
          preparationFailure(stage, safeError(error)),
        );
        outboundResults.push({
          destinationId: dest.id,
          outboundMessageId: message.id,
          status: 'OUT-ERROR',
        });
        continue;
      }
      message.transformed_payload = serialize(outbound);
      message.transport_config = encrypt(serialize({ ...dest, preparation_version: 1 }));
      const prepared = await pool
        .request()
        .input('id', message.id)
        .input('payload', message.transformed_payload)
        .input('snapshot', message.transport_config)
        .input('owner', message.lease_owner || null)
        .query(
          `UPDATE "Messages" SET transformed_payload=@payload,transport_config=@snapshot,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND lease_owner=@owner AND status='PROCESSING'`,
        );
      if (prepared.rowsAffected && prepared.rowsAffected[0] !== 1)
        throw new AppError(
          409,
          'DELIVERY_LEASE_LOST',
          'Delivery lease changed before payload preparation completed',
        );
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
      .input(
        'error',
        persistValidationFailure(
          safeError(error),
          error instanceof FieldValidationError ? error.results : undefined,
        ),
      )
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
    observe('processing_seconds', (performance.now() - started) / 1000);
  }
}
export async function processRetry(message: StoredMessage & { last_error?: string }) {
  let dest: Destination;
  try {
    dest = await preparedDestination(message);
  } catch (error) {
    const pool = await getConnection();
    await pool
      .request()
      .input('id', message.id)
      .input('owner', message.lease_owner || null)
      .input('error', safeError(error))
      .query(
        `UPDATE "Messages" SET status='OUT-ERROR',last_error=@error,transport_config=NULL,next_retry_at=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND lease_owner=@owner AND status='RETRYING'`,
      );
    await updateAggregate(message.inbound_message_id);
    throw error;
  }
  const result = await attempt(message, dest, message.retry_count + 1);
  await updateAggregate(message.inbound_message_id);
  return result;
}
export async function resendMessage(id: number) {
  const row = await withTransaction(async (tx) => {
    const candidate = (
      await tx
        .request()
        .input('id', id)
        .query(
          `SELECT * FROM "Messages" WHERE id=@id AND direction='OUT' AND status IN ('OUT-ERROR','DEAD_LETTER') AND destination_id IS NOT NULL AND transport_config IS NOT NULL AND EXISTS(SELECT 1 FROM "Destinations" d WHERE d.id="Messages".destination_id AND d.is_enabled=true AND d.is_deleted=false) AND EXISTS(SELECT 1 FROM "Channels" c WHERE c.id="Messages".channel_id AND c.status='RUNNING') FOR UPDATE`,
        )
    ).recordset[0] as StoredMessage | undefined;
    if (!candidate) return undefined;
    await preparedDestination(candidate, tx);
    return (
      await tx
        .request()
        .input('id', id)
        .query(
          `UPDATE "Messages" SET status='RETRYING',lease_owner=gen_random_uuid()::text,lease_until=(CURRENT_TIMESTAMP + (300)::double precision * INTERVAL \'1 second\') WHERE id=@id AND status IN ('OUT-ERROR','DEAD_LETTER') RETURNING *`,
        )
    ).recordset[0] as StoredMessage | undefined;
  });
  if (!row)
    throw new AppError(
      409,
      'RESEND_UNAVAILABLE',
      'Resend requires a failed message with a saved connector and running channel',
    );
  // Send the saved final payload once; transforms/templates are never applied twice.
  return processRetry(row);
}
