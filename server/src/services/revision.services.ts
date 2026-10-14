import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseTransaction } from '../config/db.js';
import { getConnection, withTransaction } from '../config/db.js';
import { channelSchema, draftPatchSchema } from '../utils/validator.js';
import { runConfiguration } from './dryRun.services.js';
import { maskPayload } from '../utils/masking.js';
import { decrypt, encrypt, publicEndpoint, storeEndpoint } from '../utils/secrets.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.services.js';
import { saveDestinations, applyChannelConfiguration } from './channel.services.js';
import { validateProfileConfiguration } from './profileValidation.services.js';
import { validateEndpoint, testConnection } from '../utils/transport.js';
import type { z } from 'zod';
export type RevisionConfig = z.infer<typeof channelSchema>;
export async function readRuntimeConfiguration(
  tx: DatabaseTransaction,
  id: number,
): Promise<RevisionConfig> {
  const c = (await tx.request().input('id', id).query('SELECT * FROM "Channels" WHERE id=@id'))
    .recordset[0];
  if (!c) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
  const destinations = (
    await tx
      .request()
      .input('id', id)
      .query('SELECT * FROM "Destinations" WHERE channel_id=@id AND is_deleted=false ORDER BY id')
  ).recordset;
  return channelSchema.parse({
    name: c.name,
    validationProfile: JSON.parse(c.validation_profile || '{}'),
    source: { type: c.source_type, inboundDataType: c.inbound_data_type },
    processingScript: c.processing_script || '',
    responseScript: c.response_script || '',
    filterScript: c.filter_script || '',
    idempotencyMode: c.idempotency_mode || 'OPTIONAL',
    destinations: destinations.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      endpoint: decrypt(d.endpoint),
      outboundDataType: d.outbound_data_type,
      processingScript: d.processing_script || '',
      responseScript: d.response_script || '',
      templateScript: d.template_script || '',
      filterScript: d.filter_script || '',
      isEnabled: d.is_enabled,
      retryEnabled: d.retry_enabled,
      maxRetries: d.max_retries,
      retryIntervalSeconds: d.retry_interval_seconds,
      timeoutMs: d.timeout_ms,
      deliveryPolicy: d.delivery_policy || {},
    })),
  });
}
export async function insertRevision(
  tx: DatabaseTransaction,
  id: number,
  data: RevisionConfig,
  state: 'DRAFT' | 'PUBLISHED',
  summary: string,
  user?: number,
) {
  const revision = Number(
    (
      await tx
        .request()
        .input('id', id)
        .query(
          'SELECT COALESCE(MAX(revision),0)+1 revision FROM "ChannelRevisions" WHERE channel_id=@id',
        )
    ).recordset[0]?.revision || 1,
  );
  const configuration = JSON.stringify(data),
    checksum = createHash('sha256').update(configuration).digest('hex');
  await tx
    .request()
    .input('id', id)
    .input('revision', revision)
    .input('state', state)
    .input('config', encrypt(configuration))
    .input('checksum', checksum)
    .input('summary', summary)
    .input('user', user || null)
    .query(
      'INSERT INTO "ChannelRevisions"(channel_id,revision,state,configuration,checksum,change_summary,created_by,published_at) VALUES(@id,@revision,@state,@config,@checksum,@summary,@user,CASE WHEN @state=\'PUBLISHED\' THEN CURRENT_TIMESTAMP ELSE NULL END)',
    );
  if (state === 'PUBLISHED')
    await tx
      .request()
      .input('id', id)
      .input('revision', revision)
      .query('UPDATE "Channels" SET active_revision=@revision WHERE id=@id');
  return revision;
}
export async function createDraft(
  tx: DatabaseTransaction,
  id: number,
  data: RevisionConfig,
  req: Request,
) {
  const old = (
    await tx
      .request()
      .input('id', id)
      .query('SELECT * FROM "Destinations" WHERE channel_id=@id AND is_deleted=false')
  ).recordset;
  const snapshot = {
    ...data,
    destinations: data.destinations.map((d) => {
      const previous = old.find((o) => o.id === d.id);
      if (d.id && !previous)
        throw new AppError(400, 'INVALID_DESTINATION', 'Destination does not belong to channel');
      validateEndpoint(d.endpoint, d.type);
      return { ...d, endpoint: decrypt(storeEndpoint(d.endpoint, previous?.endpoint)) };
    }),
  };
  const revision = await insertRevision(
    tx,
    id,
    snapshot,
    'DRAFT',
    data.changeSummary || 'Legacy API update: review before publish',
    req.user?.id,
  );
  await audit('CREATE_CHANNEL_DRAFT', req, 'channel', id, tx);
  return revision;
}
// Diff and exports omit endpoint credentials and script contents, which may contain embedded secrets.
export function safeRevision(data: RevisionConfig) {
  const script = (v: string) => (v ? '[CONFIGURED]' : '');
  return {
    ...data,
    validationProfile: {
      ...data.validationProfile,
      script: script(data.validationProfile.script || ''),
    },
    processingScript: script(data.processingScript),
    responseScript: script(data.responseScript),
    filterScript: script(data.filterScript),
    destinations: data.destinations.map((d) => ({
      ...d,
      ...publicEndpoint(d.endpoint),
      processingScript: script(d.processingScript),
      responseScript: script(d.responseScript),
      filterScript: script(d.filterScript),
      templateScript: script(d.templateScript),
    })),
  };
}
export const listRevisions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getConnection();
    const rows = await pool
      .request()
      .input('id', Number(req.params.id))
      .query(
        'SELECT revision,state,checksum,change_summary,created_by,created_at,published_at FROM "ChannelRevisions" WHERE channel_id=@id ORDER BY revision DESC LIMIT 100',
      );
    res.json({ success: true, data: rows.recordset });
  } catch (error) {
    next(error);
  }
};
export const revisionDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getConnection();
    const row = (
      await pool
        .request()
        .input('id', Number(req.params.id))
        .input('revision', Number(req.params.revision))
        .query('SELECT * FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision')
    ).recordset[0];
    if (!row) throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not found');
    const data = channelSchema.parse(JSON.parse(decrypt(row.configuration)));
    res.json({ success: true, data: safeRevision(data), checksum: row.checksum });
  } catch (error) {
    next(error);
  }
};
export const publishRevision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const revision = await withTransaction(async (tx) => {
      const id = Number(req.params.id),
        requested = Number(req.params.revision);
      const c = (
        await tx
          .request()
          .input('id', id)
          .query('SELECT id,active_revision FROM "Channels" WHERE id=@id FOR UPDATE')
      ).recordset[0];
      if (!c) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      if (req.body.expectedActiveRevision !== c.active_revision)
        throw new AppError(
          409,
          'REVISION_CONFLICT',
          'Active revision changed; reload before publishing',
        );
      const row = (
        await tx
          .request()
          .input('id', id)
          .input('revision', requested)
          .query(
            'SELECT * FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision FOR UPDATE',
          )
      ).recordset[0];
      if (!row || row.state === 'ARCHIVED')
        throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not available');
      const rollback = req.path.endsWith('/rollback');
      if (!rollback && row.state !== 'DRAFT')
        throw new AppError(409, 'REVISION_ALREADY_PUBLISHED', 'Revision already published');
      if (rollback && row.state !== 'PUBLISHED')
        throw new AppError(409, 'ROLLBACK_UNAVAILABLE', 'Rollback requires a published revision');
      const data = channelSchema.parse(JSON.parse(decrypt(row.configuration)));
      validateProfileConfiguration(data.validationProfile);
      // Preserve historical destination IDs so saved deliveries keep their FK links.
      await tx
        .request()
        .input('id', id)
        .query(
          'UPDATE "Destinations" SET is_deleted=false WHERE channel_id=@id AND is_deleted=true',
        );
      await applyChannelConfiguration(tx, id, data);
      await saveDestinations(tx, id, data.destinations);
      const revision = await insertRevision(
        tx,
        id,
        data,
        'PUBLISHED',
        req.body.changeSummary,
        req.user?.id,
      );
      if (!rollback)
        await tx
          .request()
          .input('id', id)
          .input('revision', requested)
          .query(
            'UPDATE "ChannelRevisions" SET state=\'ARCHIVED\' WHERE channel_id=@id AND revision=@revision',
          );
      await audit(rollback ? 'ROLLBACK_CHANNEL' : 'PUBLISH_CHANNEL', req, 'channel', id, tx);
      return revision;
    });
    res.json({ success: true, activeRevision: revision });
  } catch (error) {
    next(error);
  }
};
export const archiveRevision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await withTransaction(async (tx) => {
      const id = Number(req.params.id);
      await tx.request().input('id', id).query('SELECT id FROM "Channels" WHERE id=@id FOR UPDATE');
      const r = await tx
        .request()
        .input('id', id)
        .input('revision', Number(req.params.revision))
        .query(
          "UPDATE \"ChannelRevisions\" SET state='ARCHIVED' WHERE channel_id=@id AND revision=@revision AND state='DRAFT'",
        );
      if (!r.rowsAffected[0])
        throw new AppError(409, 'ARCHIVE_UNAVAILABLE', 'Only draft revisions can be archived');
      await audit('ARCHIVE_REVISION', req, 'channel', id, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
export function patchDraft(
  data: RevisionConfig,
  input: z.infer<typeof draftPatchSchema>['patch'],
): RevisionConfig {
  const changes = new Map((input.destinations || []).map((d) => [d.index, d]));
  if (
    changes.size !== (input.destinations || []).length ||
    [...changes.keys()].some((i) => i >= data.destinations.length)
  )
    throw new AppError(400, 'INVALID_DESTINATION', 'Invalid or duplicate draft destination index');
  return channelSchema.parse({
    ...data,
    ...input,
    source: { ...data.source, ...input.source },
    destinations: data.destinations.map((destination, index) => {
      const change = changes.get(index);
      if (!change) return destination;
      const { index: _index, ...fields } = change;
      void _index;
      return { ...destination, ...fields };
    }),
  });
}
export const editDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = draftPatchSchema.parse(req.body);
    const revision = await withTransaction(async (tx) => {
      const id = Number(req.params.id),
        requested = Number(req.params.revision);
      const channel = (
        await tx
          .request()
          .input('id', id)
          .query('SELECT id FROM "Channels" WHERE id=@id FOR UPDATE')
      ).recordset[0];
      if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      const row = (
        await tx
          .request()
          .input('id', id)
          .input('revision', requested)
          .query(
            'SELECT * FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision FOR UPDATE',
          )
      ).recordset[0];
      if (!row) throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not found');
      if (row.state !== 'DRAFT' || row.checksum !== input.expectedChecksum)
        throw new AppError(
          409,
          'DRAFT_CONFLICT',
          'Draft changed or is no longer editable; reload revisions',
        );
      const data = patchDraft(
        channelSchema.parse(JSON.parse(decrypt(row.configuration))),
        input.patch,
      );
      validateProfileConfiguration(data.validationProfile);
      const successor = await insertRevision(
        tx,
        id,
        data,
        'DRAFT',
        input.changeSummary,
        req.user?.id,
      );
      await tx
        .request()
        .input('id', id)
        .input('revision', requested)
        .query(
          'UPDATE "ChannelRevisions" SET state=\'ARCHIVED\' WHERE channel_id=@id AND revision=@revision',
        );
      await audit('EDIT_CHANNEL_DRAFT', req, 'channel', id, tx);
      return successor;
    });
    res.json({ success: true, draft: true, revision });
  } catch (error) {
    next(error);
  }
};
export const dryRunRevision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getConnection();
    const row = (
      await pool
        .request()
        .input('id', Number(req.params.id))
        .input('revision', Number(req.params.revision))
        .query(
          'SELECT configuration,state FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision',
        )
    ).recordset[0];
    if (!row || row.state === 'ARCHIVED')
      throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not available');
    const result = await runConfiguration(
      channelSchema.parse(JSON.parse(decrypt(row.configuration))),
      req.body.payload,
    );
    await audit('DRY_RUN_REVISION', req, 'channel', Number(req.params.id));
    res.json({
      ...result,
      revision: Number(req.params.revision),
      results: result.results.map((r) => ({ ...r, finalPayload: maskPayload(r.finalPayload) })),
    });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(400, 'DRY_RUN_INVALID', 'Invalid configuration or synthetic payload'),
    );
  }
};
let activeProbes = 0;
export const testRevisionDestination = async (req: Request, res: Response, next: NextFunction) => {
  if (activeProbes >= 4)
    return next(new AppError(503, 'CONNECTION_TEST_CAPACITY', 'Connection test capacity exceeded'));
  activeProbes++;
  try {
    const pool = await getConnection();
    const row = (
      await pool
        .request()
        .input('id', Number(req.params.id))
        .input('revision', Number(req.params.revision))
        .query(
          'SELECT configuration,state FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision',
        )
    ).recordset[0];
    if (!row || row.state === 'ARCHIVED')
      throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not available');
    const data = channelSchema.parse(JSON.parse(decrypt(row.configuration)));
    const destination = data.destinations[Number(req.params.index)];
    if (!destination) throw new AppError(404, 'DESTINATION_NOT_FOUND', 'Destination not found');
    await audit('TEST_DESTINATION_CONNECTION', req, 'channel', Number(req.params.id));
    const result = await testConnection(destination.endpoint, destination.type);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  } finally {
    activeProbes--;
  }
};
