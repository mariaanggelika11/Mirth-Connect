import { querySchema } from './monitor/query.js';
import { parsed, logRow } from './monitor/mapping.js';
import { listMessages, findMessage, listDeliveryLogs, messageStats } from './monitor/repository.js';
import type { Request, Response, NextFunction } from 'express';
import { getConnection } from '../config/db.js';
import {
  processInboundMessage,
  resendMessage as engineResend,
} from './messageProcessor.services.js';
import { AppError } from '../utils/errors.js';
import { hasPermission } from '../middleware/auth.js';
import { audit } from './audit.services.js';
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
export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const checked = querySchema.safeParse(req.query);
    if (!checked.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid monitor filters');
    const q = checked.data;
    const { messages, logs, total } = await listMessages(q);
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
      pagination: { page: q.page, pageSize: q.pageSize, total },
    });
  } catch (error) {
    next(error);
  }
};
export const getMessageDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const m = await findMessage(id);
    const logPage = Number(req.query.logPage || 1),
      logPageSize = 5;
    if (!Number.isSafeInteger(logPage) || logPage < 1 || logPage > 1000000)
      throw new AppError(400, 'INVALID_QUERY', 'Invalid destination log page');
    const payload = !!req.user && hasPermission(req.user.role, 'message:payload');
    const logs = await listDeliveryLogs(id, logPage, logPageSize);
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
    res.json(await messageStats(today));
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
