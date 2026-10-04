import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { encrypt } from '../utils/secrets.js';
import type { DatabaseTransaction } from '../config/db.js';
import { z } from 'zod';
import { getConnection, withTransaction } from '../config/db.js';
import { config } from '../config/env.js';
import { channelSchema } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { publicEndpoint, storeEndpoint } from '../utils/secrets.js';
import { validateEndpoint } from '../utils/transport.js';
import type { Destination } from '../models/Destination.js';
import { finalStatus } from './messageProcessor.services.js';
import { hasPermission } from '../middleware/auth.js';
import { audit } from './audit.services.js';
type ChannelInput = z.infer<typeof channelSchema>;
interface ChannelRow {
  id: number;
  name: string;
  status: string;
  source_type: string;
  source_endpoint: string;
  inbound_data_type: string;
  processing_script: string;
  response_script: string;
  filter_script: string;
  source_api_key: string;
  created_at: Date;
  updated_at: Date;
  received: number;
  sent: number;
  errors: number;
}
interface DestinationRow extends Destination {
  sent: number;
  errors: number;
  is_enabled: boolean;
}

function endpoint(type: string, id: number) {
  return type === 'HTTP'
    ? `${config.inbound.baseUrl}${config.inbound.path}/${id}`
    : `MLLP:${config.hl7.port}`;
}
export const getAllChannels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mayConfigure = !!req.user && hasPermission(req.user.role, 'channel:write');
    const pool = await getConnection();
    const result = await pool.request().query(`
      SELECT c.*,COALESCE(x.received,0) received,COALESCE(x.sent,0) sent,COALESCE(x.errors,0) errors FROM "Channels" c
      LEFT JOIN (SELECT channel_id,SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) received,SUM(CASE WHEN direction='OUT' AND status='OUT-SENT' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN status IN ('IN-ERROR','OUT-ERROR','DEAD_LETTER') THEN 1 ELSE 0 END) errors FROM "Messages" GROUP BY channel_id) x ON x.channel_id=c.id ORDER BY c.created_at DESC;
      SELECT d.*,COALESCE(x.sent,0) sent,COALESCE(x.errors,0) errors FROM "Destinations" d
      LEFT JOIN (SELECT destination_id,SUM(CASE WHEN status='OUT-SENT' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN status='OUT-ERROR' THEN 1 ELSE 0 END) errors FROM "MessageDestinationLog" GROUP BY destination_id) x ON x.destination_id=d.id WHERE d.is_deleted=false ORDER BY d.id;
    `);
    const sets = result.recordsets as unknown as [ChannelRow[], DestinationRow[]];
    const byChannel = new Map<number, Record<string, unknown>[]>();
    for (const d of sets[1]) {
      const list = byChannel.get(d.channel_id) || [];
      list.push({
        id: d.id,
        channel_id: d.channel_id,
        name: d.name,
        type: d.type,
        ...publicEndpoint(d.endpoint),
        outboundDataType: d.outbound_data_type,
        processingScript: mayConfigure ? d.processing_script || '' : '',
        responseScript: mayConfigure ? d.response_script || '' : '',
        templateScript: mayConfigure ? d.template_script || '' : '',
        filterScript: mayConfigure ? d.filter_script || '' : '',
        isEnabled: !!d.is_enabled,
        retryEnabled: !!d.retry_enabled,
        maxRetries: d.max_retries,
        retryIntervalSeconds: d.retry_interval_seconds,
        timeoutMs: d.timeout_ms,
        sent: d.sent,
        errors: d.errors,
      });
      byChannel.set(d.channel_id, list);
    }
    res.json(
      sets[0].map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        apiKeyConfigured: !!c.source_api_key,
        source: {
          type: c.source_type,
          endpoint: c.source_endpoint,
          inboundDataType: c.inbound_data_type,
        },
        processingScript: mayConfigure ? c.processing_script : '',
        responseScript: mayConfigure ? c.response_script : '',
        filterScript: mayConfigure ? c.filter_script : '',
        created_at: c.created_at,
        updated_at: c.updated_at,
        received: c.received,
        sent: c.sent,
        errors: c.errors,
        destinations: byChannel.get(c.id) || [],
      })),
    );
  } catch (error) {
    next(error);
  }
};
async function saveDestinations(
  tx: DatabaseTransaction,
  channelId: number,
  items: ChannelInput['destinations'],
) {
  const existing = (
    await tx
      .request()
      .input('id', channelId)
      .query('SELECT * FROM "Destinations" WHERE channel_id=@id AND is_deleted=false')
  ).recordset;
  for (const d of items) {
    const old = existing.find((e) => e.id === d.id);
    if (d.id && !old)
      throw new AppError(400, 'INVALID_DESTINATION', 'Destination does not belong to channel');
    const raw = d.endpoint;
    validateEndpoint(raw, d.type);
    const stored = storeEndpoint(raw, old?.endpoint);
    const r = tx
      .request()
      .input('channel_id', channelId)
      .input('id', d.id ?? null)
      .input('name', d.name)
      .input('type', d.type)
      .input('endpoint', stored)
      .input('data_type', d.outboundDataType)
      .input('processing', d.processingScript)
      .input('response', d.responseScript)
      .input('template', d.templateScript)
      .input('filter', d.filterScript)
      .input('enabled', d.isEnabled)
      .input('retry', d.retryEnabled)
      .input('maxRetries', d.maxRetries)
      .input('interval', d.retryIntervalSeconds)
      .input('timeout', d.timeoutMs);
    if (old)
      await r.query(
        `UPDATE "Destinations" SET name=@name,type=@type,endpoint=@endpoint,outbound_data_type=@data_type,processing_script=@processing,response_script=@response,template_script=@template,filter_script=@filter,is_enabled=@enabled,retry_enabled=@retry,max_retries=@maxRetries,retry_interval_seconds=@interval,timeout_ms=@timeout,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND channel_id=@channel_id`,
      );
    else
      await r.query(
        `INSERT INTO "Destinations"(channel_id,name,type,endpoint,outbound_data_type,processing_script,response_script,template_script,filter_script,is_enabled,retry_enabled,max_retries,retry_interval_seconds,timeout_ms,created_at,updated_at) VALUES(@channel_id,@name,@type,@endpoint,@data_type,@processing,@response,@template,@filter,@enabled,@retry,@maxRetries,@interval,@timeout,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      );
  }
  // Keep historical logs and FK links by disabling removed connectors instead of deleting evidence.
  for (const old of existing.filter((e) => !items.some((d) => d.id === e.id))) {
    const changed = (
      await tx
        .request()
        .input('id', old.id)
        .query(
          "UPDATE \"Destinations\" SET is_enabled=false,is_deleted=true,updated_at=CURRENT_TIMESTAMP WHERE id=@id; UPDATE \"Messages\" SET status='DEAD_LETTER',last_error='CONNECTOR_REMOVED',next_retry_at=NULL WHERE destination_id=@id AND status='QUEUED' RETURNING inbound_message_id",
        )
    ).recordset;
    for (const parent of new Set<number>(changed.map((r) => r.inbound_message_id))) {
      const rows = (
        await tx
          .request()
          .input('id', parent)
          .query('SELECT status FROM "Messages" WHERE inbound_message_id=@id AND direction=\'OUT\'')
      ).recordset;
      await tx
        .request()
        .input('id', parent)
        .input('status', finalStatus(rows.map((r) => r.status)))
        .query('UPDATE "Messages" SET status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@id');
    }
  }
}
async function saveChannel(req: Request, res: Response, next: NextFunction, create: boolean) {
  try {
    const data: ChannelInput = req.body;
    const id = await withTransaction(async (tx) => {
      let id = Number(req.params.id);
      if (create) {
        id = (
          await tx
            .request()
            .input('name', data.name)
            .input('type', data.source.type)
            .input('dataType', data.source.inboundDataType)
            .input('processing', data.processingScript)
            .input('response', data.responseScript)
            .input('filter', data.filterScript)
            .query(
              `INSERT INTO "Channels"(name,status,source_type,source_endpoint,inbound_data_type,processing_script,response_script,filter_script,created_at,updated_at) VALUES(@name,'STOPPED',@type,'',@dataType,@processing,@response,@filter,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`,
            )
        ).recordset[0].id;
      } else {
        const found = (
          await tx
            .request()
            .input('id', id)
            .query('SELECT id FROM "Channels" WHERE id=@id FOR UPDATE')
        ).recordset[0];
        if (!found) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      }
      await tx
        .request()
        .input('id', id)
        .input('name', data.name)
        .input('type', data.source.type)
        .input('endpoint', endpoint(data.source.type, id))
        .input('dataType', data.source.inboundDataType)
        .input('processing', data.processingScript)
        .input('response', data.responseScript)
        .input('filter', data.filterScript)
        .query(
          `UPDATE "Channels" SET name=@name,source_type=@type,source_endpoint=@endpoint,inbound_data_type=@dataType,processing_script=@processing,response_script=@response,filter_script=@filter,updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
        );
      await saveDestinations(tx, id, data.destinations);
      await audit(create ? 'CREATE_CHANNEL' : 'UPDATE_CHANNEL', req, 'channel', id, tx);
      return id;
    });
    res.status(create ? 201 : 200).json({
      success: true,
      message: 'Channel saved successfully',
      channelId: id,
      endpoint: endpoint(data.source.type, id),
    });
  } catch (error) {
    next(error);
  }
}
export const createChannel = (req: Request, res: Response, next: NextFunction) =>
  saveChannel(req, res, next, true);
export const updateChannel = (req: Request, res: Response, next: NextFunction) =>
  saveChannel(req, res, next, false);
export const deleteChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await withTransaction(async (tx) => {
      const found = (
        await tx
          .request()
          .input('id', Number(req.params.id))
          .query('SELECT id,status FROM "Channels" WHERE id=@id FOR UPDATE')
      ).recordset[0];
      if (!found) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      if (found.status === 'RUNNING')
        throw new AppError(409, 'CHANNEL_RUNNING', 'Stop the channel before deleting');
      const messages = (
        await tx
          .request()
          .input('id', found.id)
          .query('SELECT id FROM "Messages" WHERE channel_id=@id LIMIT 1')
      ).recordset;
      if (messages.length)
        throw new AppError(
          409,
          'CHANNEL_HAS_MESSAGES',
          'Channel has retained messages; wait for retention cleanup before deleting',
        );
      await tx
        .request()
        .input('id', found.id)
        .query(
          'DELETE FROM "Destinations" WHERE channel_id=@id; DELETE FROM "Channels" WHERE id=@id;',
        );
      await audit('DELETE_CHANNEL', req, 'channel', found.id, tx);
    });
    res.json({ success: true, message: 'Channel deleted successfully' });
  } catch (error) {
    next(error);
  }
};
export const updateChannelStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await withTransaction(async (tx) => {
      const r = await tx
        .request()
        .input('id', Number(req.params.id))
        .input('status', req.body.status)
        .query('UPDATE "Channels" SET status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@id');
      if (!r.rowsAffected[0]) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      await audit(
        req.body.status === 'RUNNING' ? 'START_CHANNEL' : 'STOP_CHANNEL',
        req,
        'channel',
        Number(req.params.id),
        tx,
      );
    });
    res.json({ success: true, message: 'Channel status updated' });
  } catch (error) {
    next(error);
  }
};

export const rotateSourceCredential = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = randomBytes(32).toString('hex');
    await withTransaction(async (tx) => {
      const result = await tx
        .request()
        .input('id', Number(req.params.id))
        .input('key', encrypt(key))
        .query(
          'UPDATE "Channels" SET source_api_key=@key,updated_at=CURRENT_TIMESTAMP WHERE id=@id',
        );
      if (!result.rowsAffected[0])
        throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      await audit('ROTATE_CONNECTOR_KEY', req, 'channel', Number(req.params.id), tx);
    });
    res.set('Cache-Control', 'no-store').json({ success: true, data: { apiKey: key } });
  } catch (error) {
    next(error);
  }
};
