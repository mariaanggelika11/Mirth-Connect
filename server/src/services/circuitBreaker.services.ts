import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { config } from '../config/env.js';
export async function acquireDelivery(messageId: number, destinationId: number) {
  const owner = randomUUID();
  return withTransaction(async (tx) => {
    await tx.request().query('SELECT pg_advisory_xact_lock(741203,5)');
    await tx
      .request()
      .input('dest', destinationId)
      .query(
        'INSERT INTO "DestinationRuntime"(destination_id) VALUES(@dest) ON CONFLICT DO NOTHING',
      );
    const runtime = (
      await tx
        .request()
        .input('dest', destinationId)
        .query(
          'SELECT *,open_until>CURRENT_TIMESTAMP is_open,probe_until>CURRENT_TIMESTAMP probing FROM "DestinationRuntime" WHERE destination_id=@dest FOR UPDATE',
        )
    ).recordset[0];
    if (runtime?.is_open || runtime?.probing)
      return { acquired: false, reason: 'DESTINATION_CIRCUIT_OPEN', owner };
    const counts = (
      await tx
        .request()
        .input('dest', destinationId)
        .query(
          'SELECT count(*) total,count(*) FILTER(WHERE destination_id=@dest) destination FROM "DeliverySlots" WHERE expires_at>CURRENT_TIMESTAMP',
        )
    ).recordset[0];
    if (
      Number(counts?.total || 0) >= config.delivery.maxActive ||
      Number(counts?.destination || 0) >= config.delivery.maxPerDestination
    )
      return { acquired: false, reason: 'DELIVERY_CAPACITY', owner };
    const result = await tx
      .request()
      .input('id', messageId)
      .input('dest', destinationId)
      .input('owner', owner)
      .query(
        'INSERT INTO "DeliverySlots"(message_id,destination_id,owner,expires_at) VALUES(@id,@dest,@owner,CURRENT_TIMESTAMP+INTERVAL \'300 seconds\') ON CONFLICT(message_id) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE "DeliverySlots".expires_at<CURRENT_TIMESTAMP RETURNING message_id',
      );
    if (!result.recordset[0] && result.rowsAffected?.[0] === 0)
      return { acquired: false, reason: 'DELIVERY_ALREADY_ACTIVE', owner };
    if (runtime?.open_until)
      await tx
        .request()
        .input('dest', destinationId)
        .query(
          'UPDATE "DestinationRuntime" SET probe_until=CURRENT_TIMESTAMP+INTERVAL \'300 seconds\' WHERE destination_id=@dest',
        );
    return { acquired: true, reason: '', owner };
  });
}
export async function releaseDelivery(
  messageId: number,
  destinationId: number,
  owner: string,
  success: boolean,
) {
  await withTransaction(async (tx) => {
    await tx
      .request()
      .input('id', messageId)
      .input('owner', owner)
      .query('DELETE FROM "DeliverySlots" WHERE message_id=@id AND owner=@owner');
    await tx
      .request()
      .input('dest', destinationId)
      .input('success', success)
      .input('threshold', config.delivery.failureThreshold)
      .input('seconds', config.delivery.openSeconds)
      .query(
        'UPDATE "DestinationRuntime" SET failure_count=CASE WHEN @success THEN 0 ELSE failure_count+1 END,open_until=CASE WHEN @success THEN NULL WHEN failure_count+1>=@threshold THEN CURRENT_TIMESTAMP+@seconds::double precision*INTERVAL \'1 second\' ELSE open_until END,probe_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE destination_id=@dest',
      );
  });
}
