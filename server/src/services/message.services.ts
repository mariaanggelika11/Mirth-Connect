import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getConnection } from '../config/db.js';
import {
  processInboundMessage,
  resendMessage as engineResend,
} from './messageProcessor.services.js';
import { AppError } from '../utils/errors.js';
import { hasPermission } from '../middleware/auth.js';
import { audit } from './audit.services.js';
interface MonitorRow {
  id: number;
  channel_id: number;
  direction: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  correlation_id: string;
  retry_count: number;
  last_error: string;
  next_retry_at: Date;
  channel_name: string;
  original_payload: string;
  transformed_payload: string;
}
interface DestinationLogRow {
  id: number;
  message_id: number;
  destination_id: number;
  destination_name: string;
  status: string;
  sent_at: Date;
  ack_code: string;
  message_control_id: string;
  request_data: string;
  outbound_data: string;
  response_text: string;
  inbound_message_id: number;
  retry_eligible?: boolean;
}
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  channelId: z.coerce.number().int().positive().optional(),
  direction: z.enum(['IN', 'OUT', 'ALL']).default('IN'),
  statusGroup: z.enum(['errors', 'pending']).optional(),
  status: z
    .enum([
      'IN-PROCESS',
      'IN-ERROR',
      'SUCCESS',
      'PARTIAL',
      'FAILED',
      'RECEIVED',
      'FILTERED',
      'OUT-SENT',
      'OUT-ERROR',
      'QUEUED',
      'RETRYING',
      'PROCESSING',
      'DEAD_LETTER',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});
export const handleInboundMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getConnection();
    const channel = (
      await pool
        .request()
        .input('id', Number(req.params.channelId))
        .query('SELECT source_type,inbound_data_type FROM "Channels" WHERE id=@id')
    ).recordset[0];
    if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
    if (channel.source_type !== 'HTTP')
      throw new AppError(409, 'SOURCE_TYPE_MISMATCH', 'Channel is not an HTTP source');
    let payload: unknown = req.body;
    if (channel.inbound_data_type === 'JSON' && typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        throw new AppError(400, 'INVALID_JSON', 'Invalid JSON payload');
      }
    }
    const result = await processInboundMessage(
      Number(req.params.channelId),
      payload,
      req.requestId,
    );
    res
      .status(result.success ? (result.inboundStatus === 'QUEUED' ? 202 : 200) : 502)
      .json({ success: result.success, result });
  } catch (error) {
    next(error);
  }
};
function parsed(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
function logRow(row: DestinationLogRow, payload: boolean) {
  return {
    id: row.id,
    messageId: row.message_id,
    destinationId: row.destination_id,
    destinationName: row.destination_name,
    status: row.status,
    sentAt: row.sent_at,
    ackCode: row.ack_code,
    messageControlId: row.message_control_id,
    canResend: row.retry_eligible === true,
    ...(payload
      ? {
          requestData: parsed(row.request_data),
          outboundData: parsed(row.outbound_data),
          responseText: row.response_text,
        }
      : {}),
  };
}
export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const checked = querySchema.safeParse(req.query);
    if (!checked.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid monitor filters');
    const q = checked.data,
      pool = await getConnection();
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
            .query<DestinationLogRow>(
              `WITH latest AS (SELECT l.id,l.message_id,l.destination_id,l.status,l.sent_at,ROW_NUMBER() OVER(PARTITION BY l.message_id ORDER BY l.id DESC) rn FROM "MessageDestinationLog" l JOIN "Messages" o ON o.id=l.message_id WHERE o.inbound_message_id IN (${ids.join(',')}) OR o.id IN (${ids.join(',')})) SELECT l.*,d.name destination_name,o.inbound_message_id,(o.status IN ('OUT-ERROR','DEAD_LETTER') AND o.transport_config IS NOT NULL AND c.status='RUNNING') retry_eligible FROM latest l JOIN "Messages" o ON o.id=l.message_id JOIN "Channels" c ON c.id=o.channel_id LEFT JOIN "Destinations" d ON d.id=l.destination_id WHERE l.rn=1 ORDER BY l.id DESC`,
            )
        ).recordset
      : [];
    res.json({
      success: true,
      data: messages.map((m) => ({
        id: m.id,
        channelId: m.channel_id,
        channelName: m.channel_name,
        timestamp: m.created_at,
        processedAt: m.updated_at,
        correlationId: m.correlation_id,
        status: m.status,
        direction: m.direction,
        level: m.last_error ? 'ERROR' : 'INFO',
        retryCount: m.retry_count,
        nextRetryAt: m.next_retry_at,
        errorCode: m.last_error,
        destinationLogs: logs
          .filter((l) => (m.direction === 'IN' ? l.inbound_message_id : l.message_id) === m.id)
          .map((l) => logRow(l, false)),
      })),
      pagination: { page: q.page, pageSize: q.pageSize, total: Number(sets[0][0].total) },
    });
  } catch (error) {
    next(error);
  }
};
export const getMessageDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getConnection(),
      id = Number(req.params.id);
    const m = (
      await pool
        .request()
        .input('id', id)
        .query<MonitorRow>(
          'SELECT m.*,c.name channel_name FROM "Messages" m JOIN "Channels" c ON c.id=m.channel_id WHERE m.id=@id',
        )
    ).recordset[0];
    if (!m) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    const logPage = Number(req.query.logPage || 1),
      logPageSize = 5;
    if (!Number.isSafeInteger(logPage) || logPage < 1 || logPage > 1000000)
      throw new AppError(400, 'INVALID_QUERY', 'Invalid destination log page');
    const payload = !!req.user && hasPermission(req.user.role, 'message:payload');
    const logs = (
      await pool
        .request()
        .input('id', id)
        .input('offset', (logPage - 1) * logPageSize)
        .input('limit', logPageSize + 1)
        .query<DestinationLogRow>(
          `SELECT l.*,d.name destination_name,(o.status IN ('OUT-ERROR','DEAD_LETTER') AND o.transport_config IS NOT NULL AND c.status='RUNNING') retry_eligible FROM "MessageDestinationLog" l JOIN "Messages" o ON o.id=l.message_id JOIN "Channels" c ON c.id=o.channel_id LEFT JOIN "Destinations" d ON d.id=l.destination_id WHERE o.inbound_message_id=@id OR o.id=@id ORDER BY l.id DESC LIMIT @limit OFFSET @offset`,
        )
    ).recordset;
    if (payload) await audit('VIEW_MESSAGE_PAYLOAD', req, 'message', id);
    res.json({
      success: true,
      data: {
        id: m.id,
        channelId: m.channel_id,
        channelName: m.channel_name,
        timestamp: m.created_at,
        status: m.status,
        direction: m.direction,
        level: m.last_error ? 'ERROR' : 'INFO',
        message: `${m.direction} - ${m.status}`,
        retryCount: m.retry_count,
        nextRetryAt: m.next_retry_at,
        correlationId: m.correlation_id,
        errorCode: m.last_error,
        payloadAllowed: payload,
        ...(payload
          ? {
              originalPayload: parsed(m.original_payload),
              transformedPayload: parsed(m.transformed_payload),
            }
          : {}),
        destinationLogs: logs.slice(0, logPageSize).map((l) => logRow(l, payload)),
        destinationPagination: {
          page: logPage,
          pageSize: logPageSize,
          hasNext: logs.length > logPageSize,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
export const getMessageStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const today = req.query.dateFrom
      ? new Date(String(req.query.dateFrom))
      : new Date(new Date().setUTCHours(0, 0, 0, 0));
    if (Number.isNaN(today.getTime())) throw new AppError(400, 'INVALID_QUERY', 'Invalid dateFrom');
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('today', today)
      .query(
        `SELECT COUNT(*) "totalMessages",COUNT(*) FILTER(WHERE direction='IN' AND created_at>=@today) "messagesToday",COUNT(*) FILTER(WHERE direction='OUT' AND status IN ('QUEUED','RETRYING')) "queuedMessages",COUNT(*) FILTER(WHERE direction='OUT' AND status='DEAD_LETTER') "deadLetterMessages",COALESCE(SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END),0) "totalReceived",COALESCE(SUM(CASE WHEN direction='OUT' AND status='OUT-SENT' THEN 1 ELSE 0 END),0) "totalSent",COALESCE(SUM(CASE WHEN status IN ('IN-ERROR','OUT-ERROR','DEAD_LETTER') THEN 1 ELSE 0 END),0) "totalErrors",(SELECT COUNT(*) FROM "Channels" WHERE status='RUNNING') "channelsRunning",(SELECT COUNT(*) FROM "Channels" WHERE status='STOPPED') "channelsStopped",(SELECT COUNT(*) FROM "Channels" WHERE status='ERROR') "channelsError" FROM "Messages"`,
      );
    res.json(result.recordset[0]);
  } catch (error) {
    next(error);
  }
};
export const resendMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await audit('RESEND_MESSAGE', req, 'message', Number(req.params.id));
    const result = await engineResend(Number(req.params.id));
    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
};
