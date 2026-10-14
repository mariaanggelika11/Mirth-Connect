import { getConnection } from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import type { MonitorRow, DestinationLogRow } from './mapping.js';
import type { MonitorQuery } from './query.js';
export async function listMessages(q: MonitorQuery) {
  const pool = await getConnection();
  const r = pool
    .request()
    .input('channel', q.channelId ?? null)
    .input('direction', q.direction)
    .input('group', q.statusGroup ?? null)
    .input('status', q.status ?? null)
    .input('search', q.search ? '%' + q.search.replace(/[\[\]%_]/g, '') + '%' : null)
    .input('from', q.dateFrom ? new Date(q.dateFrom) : null)
    .input('to', q.dateTo ? new Date(q.dateTo) : null)
    .input('offset', (q.page - 1) * q.pageSize)
    .input('size', q.pageSize);
  const where = `(@channel::bigint IS NULL OR m.channel_id=@channel) AND (@direction='ALL' OR m.direction=@direction) AND (@group::text IS NULL OR (@group='errors' AND m.status IN ('IN-ERROR','OUT-ERROR','DEAD_LETTER')) OR (@group='pending' AND m.status IN ('QUEUED','RETRYING'))) AND (@status::text IS NULL OR m.status=@status) AND (@search::text IS NULL OR c.name LIKE @search OR CAST(m.id AS text) LIKE @search) AND (@from::timestamptz IS NULL OR m.created_at>=@from) AND (@to::timestamptz IS NULL OR m.created_at<=@to)`;
  const result = await r.query(
    `SELECT COUNT(*) total FROM "Messages" m LEFT JOIN "Channels" c ON c.id=m.channel_id WHERE ${where}; SELECT m.id,m.channel_id,m.direction,m.status,m.created_at,m.updated_at,m.correlation_id,m.retry_count,m.last_error,m.next_retry_at,c.name channel_name FROM "Messages" m LEFT JOIN "Channels" c ON c.id=m.channel_id WHERE ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT @size OFFSET @offset;`,
  );
  const sets = result.recordsets as unknown as [{ total: number }[], MonitorRow[]];
  const messages = sets[1];
  const ids = messages.map((m) => Number(m.id));
  const logs = ids.length
    ? (
        await pool
          .request()
          .input('ids', ids.join(','))
          .query<DestinationLogRow>(
            `WITH latest AS (SELECT l.id,l.message_id,l.destination_id,l.status,l.sent_at,ROW_NUMBER() OVER(PARTITION BY l.message_id ORDER BY l.id DESC) rn FROM "MessageDestinationLog" l JOIN "Messages" o ON o.id=l.message_id WHERE o.inbound_message_id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[])) OR o.id IN (SELECT unnest(string_to_array(@ids, ',')::bigint[]))) SELECT l.*,d.name destination_name,o.inbound_message_id,(o.status IN ('OUT-ERROR','DEAD_LETTER') AND o.transport_config IS NOT NULL AND c.status='RUNNING' AND d.is_enabled=true AND d.is_deleted=false) retry_eligible FROM latest l JOIN "Messages" o ON o.id=l.message_id JOIN "Channels" c ON c.id=o.channel_id LEFT JOIN "Destinations" d ON d.id=l.destination_id WHERE l.rn=1 ORDER BY l.id DESC`,
          )
      ).recordset
    : [];
  return { messages, logs, total: Number(sets[0][0].total) };
}
export async function findMessage(id: number) {
  const pool = await getConnection();
  const m = (
    await pool
      .request()
      .input('id', id)
      .query<MonitorRow>(
        'SELECT m.*,c.name channel_name,(SELECT row_to_json(dl) FROM "DeadLetterCases" dl WHERE dl.message_id=m.id) reconciliation FROM "Messages" m JOIN "Channels" c ON c.id=m.channel_id WHERE m.id=@id',
      )
  ).recordset[0];
  if (!m) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  return m;
}
export async function listDeliveryLogs(id: number, logPage: number, logPageSize: number) {
  const pool = await getConnection();
  const logs = (
    await pool
      .request()
      .input('id', id)
      .input('offset', (logPage - 1) * logPageSize)
      .input('limit', logPageSize + 1)
      .query<DestinationLogRow>(
        `SELECT l.*,d.name destination_name,(o.status IN ('OUT-ERROR','DEAD_LETTER') AND o.transport_config IS NOT NULL AND c.status='RUNNING' AND d.is_enabled=true AND d.is_deleted=false) retry_eligible FROM "MessageDestinationLog" l JOIN "Messages" o ON o.id=l.message_id JOIN "Channels" c ON c.id=o.channel_id LEFT JOIN "Destinations" d ON d.id=l.destination_id WHERE o.inbound_message_id=@id OR o.id=@id ORDER BY l.id DESC LIMIT @limit OFFSET @offset`,
      )
  ).recordset;
  return logs;
}
export async function messageStats(today: Date) {
  const pool = await getConnection();
  const result = await pool
    .request()
    .input('today', today)
    .query(
      `SELECT COUNT(*) "totalMessages",COUNT(*) FILTER(WHERE direction='IN' AND created_at>=@today) "messagesToday",COUNT(*) FILTER(WHERE direction='OUT' AND status IN ('QUEUED','RETRYING')) "queuedMessages",COUNT(*) FILTER(WHERE direction='OUT' AND status='DEAD_LETTER') "deadLetterMessages",COALESCE(SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END),0) "totalReceived",COALESCE(SUM(CASE WHEN direction='OUT' AND status='OUT-SENT' THEN 1 ELSE 0 END),0) "totalSent",COALESCE(SUM(CASE WHEN status IN ('IN-ERROR','OUT-ERROR','DEAD_LETTER') THEN 1 ELSE 0 END),0) "totalErrors",(SELECT COUNT(*) FROM "Channels" WHERE status='RUNNING') "channelsRunning",(SELECT COUNT(*) FROM "Channels" WHERE status='STOPPED') "channelsStopped",(SELECT COUNT(*) FROM "Channels" WHERE status='ERROR') "channelsError" FROM "Messages"`,
    );
  return result.recordset[0];
}
