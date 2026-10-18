import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import { readSourceFilter, writeSourceFilter } from '../src/utils/sourceFilter.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  connect: vi.fn(),
  inputs: {} as Record<string, unknown>,
}));
const requestMock = () => {
  const inputs: Record<string, unknown> = {};
  return {
    input(k: string, v: unknown) {
      state.inputs[k] = v;
      inputs[k] = v;
      return this;
    },
    query: (sql: string) => state.query(sql, { ...inputs }),
  };
};
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    state.begin();
    try {
      const result = await fn({ request: requestMock });
      state.commit();
      return result;
    } catch (error) {
      state.rollback();
      throw error;
    }
  },
}));
import { withTransaction } from '../src/config/db.js';
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { decrypt, encrypt } from '../src/utils/secrets.js';
const token = signToken({ id: 1, name: 'admin', role: 'ADMIN' });
const payload = {
  name: 'channel',
  source: { type: 'HTTP', inboundDataType: 'JSON' },
  destinations: [{ name: 'dest', type: 'REST', endpoint: 'http://localhost:9100' }],
};
beforeEach(() => {
  state.inputs = {};
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id,name,role FROM "Users"'))
      return { recordset: [{ id: 1, role: 'ADMIN', name: 'admin' }], rowsAffected: [1] };
    if (sql.includes('SELECT * FROM "Channels"'))
      return {
        recordset: [{ id: 1, name: 'channel', source_type: 'HTTP', inbound_data_type: 'JSON' }],
      };
    if (sql.includes('SELECT id FROM "Channels" WHERE') || sql.includes('SELECT id,status'))
      return { recordset: [{ id: 1, status: 'STOPPED' }] };
    if (sql.includes('RETURNING id')) return { recordset: [{ id: 1 }] };
    return { recordset: [], rowsAffected: [1] };
  });
});

describe('Automatic configuration-area audit on draft creation', () => {
  const original = channelSchema.parse({
    name: 'Synthetic existing channel',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    responseScript: 'response = "SYNTHETIC-LEGACY-SOURCE";',
    processingScript: 'msg.normalized = true;',
    destinations: [
      {
        id: 9,
        name: 'Synthetic receiver',
        type: 'REST',
        endpoint: 'http://user:SYNTHETIC-PASSWORD@localhost:9100/path?token=SYNTHETIC-TOKEN',
        outboundDataType: 'XML',
        responseScript: 'response = "SYNTHETIC-LEGACY-DESTINATION";',
      },
    ],
  });
  function existingConfiguration(failAudit = false) {
    const destination = original.destinations[0];
    state.query.mockImplementation(async (sql: string, inputs: Record<string, unknown>) => {
      if (sql.includes('SELECT id,name,role'))
        return { recordset: [{ id: 1, role: 'ADMIN', name: 'admin' }] };
      if (sql.includes('SELECT * FROM "Channels"'))
        return {
          recordset: [
            {
              id: 1,
              name: original.name,
              source_type: original.source.type,
              inbound_data_type: original.source.inboundDataType,
              validation_profile: JSON.stringify(original.validationProfile),
              filter_script: original.filterScript,
              processing_script: original.processingScript,
              response_script: original.responseScript,
              idempotency_mode: original.idempotencyMode,
            },
          ],
        };
      if (sql.includes('SELECT * FROM "Destinations"'))
        return {
          recordset: [
            {
              id: destination.id,
              name: destination.name,
              type: destination.type,
              endpoint: encrypt(destination.endpoint),
              outbound_data_type: destination.outboundDataType,
              filter_script: destination.filterScript,
              processing_script: destination.processingScript,
              response_script: destination.responseScript,
              template_script: destination.templateScript,
              is_enabled: destination.isEnabled,
              retry_enabled: destination.retryEnabled,
              max_retries: destination.maxRetries,
              retry_interval_seconds: destination.retryIntervalSeconds,
              timeout_ms: destination.timeoutMs,
              delivery_policy: destination.deliveryPolicy,
            },
          ],
        };
      if (sql.includes('INSERT INTO "AuditLog"') && failAudit && inputs.action === 'SOURCE_UPDATED')
        throw new Error('SYNTHETIC-PRIVATE database error');
      return { recordset: [], rowsAffected: [1] };
    });
  }
  const save = (configuration: unknown) =>
    request(app)
      .put('/api/channel/1')
      .set('Authorization', 'Bearer ' + token)
      .send(configuration);
  const auditCalls = () =>
    state.query.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO "AuditLog"'))
      .map(([, inputs]) => inputs as Record<string, unknown>);

  it('records changed areas in the same transaction without leaking hidden configuration', async () => {
    existingConfiguration();
    const response = await save({
      ...original,
      changeSummary: 'Channel configuration updated',
      validationProfile: { basicSyntax: true },
      // Public endpoint re-entry must preserve the existing encrypted credential.
      destinations: [{ ...original.destinations[0], endpoint: 'http://localhost:9100/path' }],
    });
    expect(response.status).toBe(200);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(auditCalls().map((call) => call.action)).toEqual([
      'SOURCE_UPDATED',
      'CREATE_CHANNEL_DRAFT',
    ]);
    expect(
      auditCalls().every((call) =>
        Object.keys(call).every((key) =>
          ['userId', 'action', 'resourceType', 'resourceId', 'requestId', 'ip'].includes(key),
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(auditCalls())).not.toContain('SYNTHETIC-');
    const inserted = state.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO "ChannelRevisions"'),
    )?.[1] as Record<string, unknown>;
    expect(inserted.summary).toBe('Updated source');
    const snapshot = JSON.parse(decrypt(String(inserted.config)));
    expect(snapshot.responseScript).toBe(original.responseScript);
    expect(snapshot.destinations[0].responseScript).toBe(original.destinations[0].responseScript);
    expect(snapshot.destinations[0].endpoint).toBe(original.destinations[0].endpoint);
    expect(
      state.query.mock.calls.filter(([sql]) => sql.includes('SELECT * FROM "Channels"')),
    ).toHaveLength(1);
    expect(
      state.query.mock.calls.filter(([sql]) => sql.includes('SELECT * FROM "Destinations"')),
    ).toHaveLength(1);
  });

  it('avoids false area events on unchanged saves and preserves explicit API summaries', async () => {
    existingConfiguration();
    const response = await save({ ...original, changeSummary: 'Synthetic administrative reason' });
    expect(response.status).toBe(200);
    expect(auditCalls().map((call) => call.action)).toEqual(['CREATE_CHANNEL_DRAFT']);
    const inserted = state.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO "ChannelRevisions"'),
    )?.[1] as Record<string, unknown>;
    expect(inserted.summary).toBe('Synthetic administrative reason');
  });

  it('rolls back the draft when an area audit cannot be written', async () => {
    existingConfiguration(true);
    const response = await save({ ...original, validationProfile: { basicSyntax: true } });
    expect(response.status).toBe(500);
    expect(state.rollback).toHaveBeenCalledOnce();
    expect(state.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC-PRIVATE');
  });
});
describe('Channel transaction usage (database session mocked)', () => {
  it('commit on success', async () => {
    expect(await withTransaction(async () => 123)).toBe(123);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.rollback).not.toHaveBeenCalled();
  });
  it('rollback on failure', async () => {
    await expect(
      withTransaction(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(state.rollback).toHaveBeenCalledOnce();
    expect(state.commit).not.toHaveBeenCalled();
  });
  it('channel create uses transaction and no active state by default', async () => {
    const res = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(201);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.query.mock.calls.some((c) => c[0].includes("'STOPPED'"))).toBe(true);
    expect(state.inputs.action).toBe('CREATE_CHANNEL');
  });
  it('failed destination insert rolls back channel and audit', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id,name,role')) return { recordset: [{ id: 1, role: 'ADMIN' }] };
      if (sql.includes('RETURNING id')) return { recordset: [{ id: 1 }] };
      if (sql.includes('INSERT INTO "Destinations"')) throw new Error('SQL password must not leak');
      return { recordset: [], rowsAffected: [1] };
    });
    const res = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(500);
    expect(state.rollback).toHaveBeenCalledOnce();
    expect(state.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
  it('update is atomic', async () => {
    const res = await request(app)
      .put('/api/channel/1')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(200);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.inputs.action).toBe('CREATE_CHANNEL_DRAFT');
    expect(res.body.draft).toBe(true);
    expect(state.query.mock.calls.some((c) => c[0].includes('UPDATE "Channels" SET name'))).toBe(
      false,
    );
  });
  it('delete preserves messages and refuses running channels', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [{ id: 1, role: 'ADMIN' }]
        : sql.includes('SELECT id,status')
          ? [{ id: 1, status: 'RUNNING' }]
          : [],
    }));
    const res = await request(app)
      .delete('/api/channel/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(409);
    expect(state.rollback).toHaveBeenCalledOnce();
  });
  it('deletes a stopped unused channel including its initial revision and preserves the audit', async () => {
    const res = await request(app)
      .delete('/api/channel/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.inputs.action).toBe('DELETE_CHANNEL');
    expect(
      state.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM "ChannelRevisions"')),
    ).toBe(true);
  });
  it('refuses permanent deletion when message history exists', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [{ id: 1, role: 'ADMIN' }]
        : sql.includes('SELECT id,status')
          ? [{ id: 1, status: 'STOPPED' }]
          : sql.includes('SELECT id FROM "Messages"')
            ? [{ id: 9 }]
            : [],
    }));
    const res = await request(app)
      .delete('/api/channel/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHANNEL_HAS_MESSAGES');
    expect(state.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM'))).toBe(false);
  });
  it('archives a stopped channel without deleting history and audits it', async () => {
    const res = await request(app)
      .post('/api/channel/1/archive')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(state.inputs.action).toBe('ARCHIVE_CHANNEL');
    expect(state.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM'))).toBe(false);
  });
  it('refuses archiving a channel with pending work', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [{ id: 1, role: 'ADMIN' }]
        : sql.includes('SELECT id,status')
          ? [{ id: 1, status: 'STOPPED' }]
          : sql.includes('SELECT id FROM "Messages"')
            ? [{ id: 9 }]
            : [],
    }));
    const res = await request(app)
      .post('/api/channel/1/archive')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHANNEL_HAS_PENDING_WORK');
    expect(state.rollback).toHaveBeenCalledOnce();
  });
  it.each(['RUNNING', 'PAUSED', 'ERROR', 'ARCHIVED'])(
    'requires stopped status before archiving %s',
    async (status) => {
      state.query.mockImplementation(async (sql: string) => ({
        recordset: sql.includes('SELECT id,name,role')
          ? [{ id: 1, role: 'ADMIN' }]
          : sql.includes('SELECT id,status')
            ? [{ id: 1, status }]
            : [],
      }));
      expect(
        (
          await request(app)
            .post('/api/channel/1/archive')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(409);
      expect(state.rollback).toHaveBeenCalledOnce();
    },
  );
  it('fails closed when archiving a missing channel', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role') ? [{ id: 1, role: 'ADMIN' }] : [],
    }));
    expect(
      (
        await request(app)
          .post('/api/channel/1/archive')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(404);
    expect(state.rollback).toHaveBeenCalledOnce();
  });
  it.each(['VIEWER', 'OPERATOR', 'DEVELOPER'])(
    '%s cannot delete or archive channels',
    async (role) => {
      state.query.mockResolvedValue({ recordset: [{ id: 1, role }] });
      expect(
        (
          await request(app)
            .delete('/api/channel/1')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/channel/1/archive')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
      expect(state.begin).not.toHaveBeenCalled();
    },
  );
  for (const status of ['RUNNING', 'STOPPED'])
    it('channel status ' + status, async () => {
      const res = await request(app)
        .put('/api/channel/1/status')
        .set('Authorization', 'Bearer ' + token)
        .send({ status });
      expect(res.status).toBe(200);
      expect(state.inputs.action).toBe(status === 'RUNNING' ? 'START_CHANNEL' : 'STOP_CHANNEL');
    });
});

describe('Source filter API persistence and negative validation', () => {
  it('persists disabled rules exactly in channel storage and encrypted initial revision', async () => {
    const rule = compileSimpleCondition({
      version: 1,
      field: 'patient.id',
      operator: 'isNotEmpty',
    });
    const filterScript = writeSourceFilter(rule, false);
    const originalQuery = state.query.getMockImplementation()!;
    let persistedFilter = '';
    state.query.mockImplementation(async (sql: string, inputs: Record<string, unknown>) => {
      if (sql.includes('INSERT INTO "Channels"') || sql.includes('UPDATE "Channels" SET name='))
        persistedFilter = String(inputs.filter);
      const result = await originalQuery(sql, inputs);
      if (sql.includes('SELECT * FROM "Channels"'))
        result.recordset = result.recordset.map((row: Record<string, unknown>) => ({
          ...row,
          filter_script: persistedFilter,
        }));
      return result;
    });
    const response = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send({ ...payload, filterScript });
    expect(response.status).toBe(201);
    const stored = state.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO "Channels"'),
    )?.[1] as Record<string, unknown>;
    expect(stored.filter).toBe(filterScript);
    const revision = state.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO "ChannelRevisions"'),
    )?.[1] as Record<string, unknown>;
    const snapshot = JSON.parse(decrypt(String(revision.config)));
    expect(readSourceFilter(snapshot.filterScript)).toEqual({ enabled: false, rule });
    expect(state.commit).toHaveBeenCalledOnce();
  });
  it('rejects malformed conditions before writes without leaking their values', async () => {
    const filterScript = '/* MIRTH_SIMPLE_CONDITION_V1:%SYNTHETIC-PHI */\nreturn true;';
    const response = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send({ ...payload, filterScript });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC-PHI');
    expect(state.begin).not.toHaveBeenCalled();
  });
});
