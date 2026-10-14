import { alertTick } from './alert.services.js';
import { increment, gauge } from '../utils/runtimeMetrics.js';
import { getConnection, withTransaction } from '../config/db.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { processRetry, updateAggregate } from './messageProcessor.services.js';
import type { StoredMessage } from '../models/Message.js';
import { releasableReservation } from '../utils/idempotency.js';
let stopped = false,
  running: Promise<void> | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
export async function retryTick() {
  const pool = await getConnection();
  // Ambiguous delivery after process crash is not automatically repeated. Operator must reconcile.
  const interrupted = await pool
    .request()
    .query(
      "UPDATE \"Messages\" SET status='IN-ERROR',last_error='SOURCE_PROCESS_INTERRUPTED',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE direction='IN' AND status='IN-PROCESS' AND lease_until<CURRENT_TIMESTAMP",
    );
  increment('worker_source_lease_recoveries_total', interrupted.rowsAffected?.[0] || 0);
  const abandoned = (
    await pool
      .request()
      .query(
        `UPDATE "Messages" SET status='DEAD_LETTER',last_error='DELIVERY_OUTCOME_UNKNOWN',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE direction='OUT' AND status IN ('PROCESSING','RETRYING') AND lease_until<CURRENT_TIMESTAMP RETURNING inbound_message_id`,
      )
  ).recordset;
  increment('worker_delivery_lease_recoveries_total', abandoned.length);
  for (const id of new Set<number>(abandoned.map((r) => r.inbound_message_id)))
    await updateAggregate(id);
  const row = (
    await pool.request().query(
      `WITH candidate AS (
          SELECT m.id FROM "Messages" m
          WHERE m.direction='OUT' AND m.status='QUEUED' AND m.next_retry_at<=CURRENT_TIMESTAMP
          AND EXISTS(SELECT 1 FROM "Channels" c WHERE c.id=m.channel_id AND c.status='RUNNING')
          AND EXISTS(SELECT 1 FROM "Destinations" d WHERE d.id=m.destination_id AND d.is_enabled=true AND d.is_deleted=false)
          ORDER BY m.next_retry_at,m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED
        ) UPDATE "Messages" m SET status='RETRYING',lease_owner=gen_random_uuid()::text,lease_until=CURRENT_TIMESTAMP + INTERVAL '300 seconds'
          FROM candidate c WHERE m.id=c.id RETURNING m.*`,
    )
  ).recordset[0] as StoredMessage | undefined;
  if (row) {
    gauge('retry_worker_active', 1);
    try {
      await processRetry(row);
    } finally {
      gauge('retry_worker_active', 0);
    }
  }
}
export async function retentionTick() {
  // Bounded batches; skip inbound chains containing queued/active work. Delete children first.
  await withTransaction(async (tx) => {
    const ids = (
      await tx.request().input('days', config.retention.messages).query(`
      SELECT m.id FROM "Messages" m WHERE m.direction='IN'
      AND m.created_at<CURRENT_TIMESTAMP - @days::double precision * INTERVAL '1 day'
      AND m.status IN ('SUCCESS','FILTERED','RECEIVED')
      AND NOT EXISTS(SELECT 1 FROM "Messages" o WHERE o.inbound_message_id=m.id AND o.status IN ('PROCESSING','QUEUED','RETRYING','OUT-ERROR','DEAD_LETTER'))
      ORDER BY m.id LIMIT 100 FOR UPDATE OF m SKIP LOCKED
    `)
    ).recordset.map((r) => Number(r.id));
    await tx.request().query('DELETE FROM "DeliverySlots" WHERE expires_at<CURRENT_TIMESTAMP');
    if (ids.length) {
      await tx
        .request()
        .input('ids', ids.join(','))
        .query(
          `DELETE FROM "DeliverySlots" WHERE message_id IN (SELECT id FROM "Messages" WHERE id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[])) OR inbound_message_id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[])))`,
        );
      // IDs originate from SQL, never from a client. Lock parents until all child deletes commit.
      const selected = ids.join(',');
      await tx
        .request()
        .input('ids', selected)
        .query(
          `DELETE FROM "MessageDestinationLog" WHERE message_id IN (SELECT id FROM "Messages" WHERE id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[])) OR inbound_message_id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[])))`,
        );
      await tx
        .request()
        .input('ids', selected)
        .query(
          `DELETE FROM "Messages" WHERE inbound_message_id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[]))`,
        );
      await tx
        .request()
        .input('ids', selected)
        .query(
          `DELETE FROM "Messages" WHERE id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[]))`,
        );
    }
    await tx
      .request()
      .query(
        'DELETE FROM "RevokedTokens" WHERE token_id IN (SELECT token_id FROM "RevokedTokens" WHERE expires_at<CURRENT_TIMESTAMP LIMIT 1000)',
      );
    await tx
      .request()
      .input('days', config.retention.audit)
      .query(
        `DELETE FROM "AuditLog" WHERE id IN (SELECT id FROM "AuditLog" WHERE created_at<CURRENT_TIMESTAMP - @days::double precision * INTERVAL '1 day' ORDER BY id LIMIT 1000)`,
      );
  });
}
export async function idempotencyCleanupTick() {
  const pool = await getConnection();
  const result = await pool
    .request()
    .query(
      `UPDATE "Messages" SET dedupe_key=NULL WHERE id IN (SELECT id FROM "Messages" WHERE dedupe_key IS NOT NULL AND ${releasableReservation} ORDER BY dedupe_expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id`,
    );
  increment('idempotency_expired_total', result.recordset.length);
}
export function startWorkers() {
  stopped = false;
  let lastMaintenance = 0;
  let lastIdempotencyMaintenance = 0;
  const tick = async () => {
    if (stopped) return;
    running = (async () => {
      try {
        await retryTick();
        await alertTick();
        if (
          config.inbound.idempotencyRetentionHours > 0 &&
          Date.now() - lastIdempotencyMaintenance > 60000
        ) {
          await idempotencyCleanupTick();
          lastIdempotencyMaintenance = Date.now();
        }
        if (config.retention.enabled && Date.now() - lastMaintenance > 3600000) {
          await retentionTick();
          lastMaintenance = Date.now();
        }
      } catch {
        logger.error({ code: 'WORKER_FAILURE' }, 'Background work failed');
      }
    })();
    await running;
    running = undefined;
    if (!stopped) timer = setTimeout(tick, config.retryPollMs);
  };
  timer = setTimeout(tick, config.retryPollMs);
}
export async function stopWorkers() {
  stopped = true;
  if (timer) clearTimeout(timer);
  await running;
}
